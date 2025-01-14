require("dotenv").config();
const { ethers } = require("ethers");
const crypto = require("crypto");
const fs = require("fs");

const UNISWAP_MAINNET_ROUTER_ABI = require("./abis/router_mainnet.json");
const UNISWAP_BASE_ROUTER_ABI = require("./abis/router_base.json");
const WETH_ABI = require("./abis/weth.json");
const QUAD_MAINNET_ABI = require("./abis/quad_mainnet.json");
const QUAD_BASE_ABI = require("./abis/quad_base.json");


const CHAIN_CONFIG = {
  mainnet: {
    id: 1,
    name: 'Ethereum Mainnet',
    rpcUrl: process.env.ETH_MAINNET_RPC_URL,
    maxGasPrice: 50, // gwei
    contracts: {
      router: '0x7a250d5630B4cF539739dF2C5dAcb4c659F2488D',
      weth: '0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2',
      targetToken: process.env.MAINNET_TARGET_TOKEN,
    },
    tradingParams: {
      minAmountETH: 0.1,
      maxAmountETH: 0.3,
      minInterval: 10 * 60 * 1000,
      maxInterval: 20 * 60 * 1000,
      gasMultiplier: 1.1,
      fundAmount: 0.5, // Amount to transfer to each temp wallet
    }
  },
  base: {
    id: 8453,
    name: 'Base',
    rpcUrl: process.env.BASE_RPC_URL,
    maxGasPrice: 1000,
    contracts: {
      router: '0x4752ba5dbc23f44d87826276bf6fd6b1c372ad24',
      weth: '0x4200000000000000000000000000000000000006',
      targetToken: process.env.BASE_TARGET_TOKEN,
    },
    tradingParams: {
      minAmountETH: 0.02,
      maxAmountETH: 0.08,
      minInterval: 5 * 60 * 1000,
      maxInterval: 15 * 60 * 1000,
      gasMultiplier: 1.5,
      fundAmount: 0.1, // Amount to transfer to each temp wallet
    }
  }
};

const GLOBAL_CONFIG = {
  RANDOM_VARIANCE: 0.01,
  MIN_ETH_BALANCE: 0.001,
  ACTIVE_WALLET_PERCENTAGE: 0.7,
  RETRY_DELAY: 60000,
  CHECK_INTERVAL: 30000,
  WALLET_FUND_THRESHOLD: 0.05, // Minimum ETH balance before refunding
};

class MultiChainTradingBot {
  constructor(chainKey, mainWalletPrivateKey, tempWalletCount) {
    this.chainConfig = CHAIN_CONFIG[chainKey];
    if (!this.chainConfig) {
      throw new Error(`Unsupported chain: ${chainKey}`);
    }

    this.provider = new ethers.providers.JsonRpcProvider(this.chainConfig.rpcUrl);
    this.mainnetProvider = new ethers.providers.JsonRpcProvider(CHAIN_CONFIG.mainnet.rpcUrl);

    // Initialize main wallet
    this.mainWallet = new ethers.Wallet(mainWalletPrivateKey, this.provider);
    this.tempWalletCount = tempWalletCount;

    // Initialize contract interfaces
    if(chainKey === "mainnet") {
      this.uniswapRouter = new ethers.Contract(
        this.chainConfig.contracts.router,
        UNISWAP_MAINNET_ROUTER_ABI,
        this.provider
      );

      this.targetTokenContract = new ethers.Contract(
        this.chainConfig.contracts.targetToken,
        QUAD_MAINNET_ABI,
        this.provider
      );
    } else {
      this.uniswapRouter = new ethers.Contract(
        this.chainConfig.contracts.router,
        UNISWAP_BASE_ROUTER_ABI,
        this.provider
      );

      this.targetTokenContract = new ethers.Contract(
        this.chainConfig.contracts.targetToken,
        QUAD_MAINNET_ABI,
        this.provider
      );
    }

    this.tempWallets = [];
    this.activeWallets = new Set();
    this.walletFile = `temp_wallets_${chainKey}.json`;
  }

  async calculateSlippage(amountIn, path) {
    try {
      const amounts = await this.uniswapRouter.getAmountsOut(amountIn, path);
      const expectedOutput = amounts[amounts.length - 1];
      return ethers.utils.formatEther(expectedOutput);
    } catch (error) {
      console.error("Error calculating slippage:", error);
      return null;
    }
  }

  generateRandomAmount() {
    const { minAmountETH, maxAmountETH } = this.chainConfig.tradingParams;
    const baseAmount = minAmountETH + Math.random() * (maxAmountETH - minAmountETH);
    const variance = baseAmount * GLOBAL_CONFIG.RANDOM_VARIANCE * (Math.random() * 2 - 1);
    return baseAmount + variance;
  }

  generateRandomDelay() {
    const { minInterval, maxInterval } = this.chainConfig.tradingParams;
    return minInterval + Math.random() * (maxInterval - minInterval);
  }

  async isGasPriceAcceptable() {
    const mainnetGas = await this.mainnetProvider.getGasPrice();
    const mainnetGasGwei = Number(ethers.utils.formatUnits(mainnetGas, "gwei"));

    if (mainnetGasGwei > CHAIN_CONFIG.mainnet.maxGasPrice) {
      return false;
    }

    if (this.chainConfig.id !== 1) {
      const chainGas = await this.provider.getGasPrice();
      const chainGasGwei = Number(ethers.utils.formatUnits(chainGas, "gwei"));
      return chainGasGwei <= this.chainConfig.maxGasPrice;
    }

    return true;
  }

  async initializeTempWallets() {
    try {
      if (fs.existsSync(this.walletFile)) {
        const walletData = fs.readFileSync(this.walletFile, "utf8");
        this.tempWallets = JSON.parse(walletData);
        console.log(`Loaded ${this.tempWallets.length} temporary wallets for ${this.chainConfig.name}`);
      } else {
        for (let i = 0; i < this.tempWalletCount; i++) {
          const privateKey = crypto.randomBytes(32).toString("hex");
          const wallet = new ethers.Wallet(privateKey, this.provider);
          this.tempWallets.push({
            address: wallet.address,
            privateKey: privateKey,
            lastTradeTime: 0
          });
        }
        fs.writeFileSync(this.walletFile, JSON.stringify(this.tempWallets, null, 2));
        console.log(`Created ${this.tempWalletCount} new temporary wallets for ${this.chainConfig.name}`);
      }
      this.updateActiveWallets();
    } catch (error) {
      console.error("Error initializing temporary wallets:", error);
      throw error;
    }
  }

  async fundWallet(walletAddress) {
    try {
      const balance = await this.provider.getBalance(walletAddress);
      const balanceETH = Number(ethers.utils.formatEther(balance));

      if (balanceETH < GLOBAL_CONFIG.WALLET_FUND_THRESHOLD) {
        const fundAmount = ethers.utils.parseEther(
          this.chainConfig.tradingParams.fundAmount.toString()
        );

        const tx = await this.mainWallet.sendTransaction({
          to: walletAddress,
          value: fundAmount,
          gasLimit: 21000,
          gasPrice: await this.provider.getGasPrice()
        });

        await tx.wait();
        console.log(`Funded wallet ${walletAddress} with ${this.chainConfig.tradingParams.fundAmount} ETH`);
      }
    } catch (error) {
      console.error(`Error funding wallet ${walletAddress}:`, error);
    }
  }

  async returnFundsToMain(wallet) {
    try {
      const balance = await this.provider.getBalance(wallet.address);
      if (balance.gt(ethers.utils.parseEther("0.01"))) {
        const gasPrice = await this.provider.getGasPrice();
        const gasLimit = 21000;
        const gasCost = gasPrice.mul(gasLimit);
        const amountToSend = balance.sub(gasCost);

        if (amountToSend.gt(0)) {
          const tempWallet = new ethers.Wallet(wallet.privateKey, this.provider);
          const tx = await tempWallet.sendTransaction({
            to: this.mainWallet.address,
            value: amountToSend,
            gasLimit,
            gasPrice
          });
          await tx.wait();
          console.log(`Returned ${ethers.utils.formatEther(amountToSend)} ETH to main wallet from ${wallet.address}`);
        }
      }
    } catch (error) {
      console.error(`Error returning funds from wallet ${wallet.address}:`, error);
    }
  }

  async executeTrade(walletInfo) {
    const wallet = new ethers.Wallet(walletInfo.privateKey, this.provider);

    try {
      // Fund wallet if needed
      await this.fundWallet(wallet.address);

      const ethBalance = await this.provider.getBalance(wallet.address);
      const tokenBalance = await this.targetTokenContract.balanceOf(wallet.address);

      const ethBalanceNum = Number(ethers.utils.formatEther(ethBalance));
      const tokenBalanceNum = Number(ethers.utils.formatEther(tokenBalance));

      // console.log("ethBalanceNum: ", ethBalanceNum);
      // console.log("tokenBalanceNum: ", tokenBalanceNum);

      const tradeAmount = this.generateRandomAmount();

      // console.log("tradeAmount: ", tradeAmount);

      if (ethBalanceNum < (tradeAmount + GLOBAL_CONFIG.MIN_ETH_BALANCE)) {
        console.log(`Insufficient ETH balance in wallet ${wallet.address}`);
        return;
      }

      const canSell = tokenBalanceNum > 0;
      const isBuy = !canSell || Math.random() > 0.5;
      // const isBuy = !canSell
      // console.log("isBuy: ", isBuy);

      const gasPrice = await this.provider.getGasPrice();
      const adjustedGasPrice = gasPrice.mul(Math.floor(this.chainConfig.tradingParams.gasMultiplier * 100)).div(100);

      // console.log("gasPrice: ", ethers.utils.parseEther(gasPrice.toString()));
      // console.log("adjustedGasPrice: ", ethers.utils.parseEther(adjustedGasPrice.toString()));
      
      if (isBuy) {
        await this.buyTokensWithETH(wallet, tradeAmount, adjustedGasPrice);
      } else {
        await this.sellTokensForETH(wallet, tokenBalanceNum, adjustedGasPrice);
        // After selling, return excess ETH to main wallet
        await this.returnFundsToMain(walletInfo);
     }

      walletInfo.lastTradeTime = Date.now();
      console.log(`[${this.chainConfig.name}] Trade executed for wallet ${wallet.address}: ${isBuy ? 'BUY' : 'SELL'} ${tradeAmount} ETH`);
    } catch (error) {
      console.error(`[${this.chainConfig.name}] Trade failed for wallet ${wallet.address}:`, error);
    }
  }

  async buyTokensWithETH(wallet, amountETH, gasPrice) {
    const path = [this.chainConfig.contracts.weth, this.chainConfig.contracts.targetToken];
    const deadline = Math.floor(Date.now() / 1000) + 60 * 20;

    const amountInWei = ethers.utils.parseEther(amountETH.toFixed(18));

    const expectedOutput = await this.calculateSlippage(amountInWei, path);
    const minOut = expectedOutput ?
      ethers.utils.parseEther((Number(expectedOutput) * 0.95).toString()) :
      0;

    const tx = await this.uniswapRouter.connect(wallet).swapExactETHForTokens(
      minOut,
      path,
      wallet.address,
      deadline,
      {
        value: amountInWei,
        gasLimit: 300000,
        gasPrice
      }
    );

    await tx.wait();
  }

  async sellTokensForETH(wallet, availableAmount, gasPrice) {
    const sellPercentage = 0.3 + Math.random() * 0.4;
    const amountToSell = availableAmount * sellPercentage;

    // console.log("amountToSell" , amountToSell);
    const amountIn = ethers.utils.parseEther(amountToSell.toFixed(18));
    // console.log("amountIn" , amountIn);
    await this.targetTokenContract.connect(wallet).approve(
      this.chainConfig.contracts.router,
      amountIn
    );

    const path = [this.chainConfig.contracts.targetToken, this.chainConfig.contracts.weth];
    const deadline = Math.floor(Date.now() / 1000) + 60 * 20;

    const expectedOutput = await this.calculateSlippage(amountIn, path);
    // console.log("expectedOutput" , expectedOutput);
    const minOut = expectedOutput ?
      ethers.utils.parseEther((Number(expectedOutput) * 0.95).toFixed(18)) :
      0;
    // console.log("minOut" , minOut);
    const nonce = await wallet.getTransactionCount("latest") + 1;
    // console.log('nonce:', nonce)
    const tx = await this.uniswapRouter.connect(wallet).swapExactTokensForETH(
      amountIn,
      minOut,
      path,
      wallet.address,
      deadline,
      {
        gasLimit: 300000,
        gasPrice,
        nonce
      }
    );

    await tx.wait();
  }

  updateActiveWallets() {
    const activeCount = Math.floor(this.tempWallets.length * GLOBAL_CONFIG.ACTIVE_WALLET_PERCENTAGE);
    const shuffled = [...this.tempWallets].sort(() => 0.5 - Math.random());
    this.activeWallets = new Set(shuffled.slice(0, activeCount).map(w => w.address));
  }

  async startTrading() {
    console.log(`Starting trading bot on ${this.chainConfig.name} with main wallet ${this.mainWallet.address}...`);

    while (true) {
      try {
        if (Math.random() < 0.1) {
          this.updateActiveWallets();
          console.log(`[${this.chainConfig.name}] Updated active wallets pool`);
        }

        const gasOk = await this.isGasPriceAcceptable();
        if (!gasOk) {
          console.log(`[${this.chainConfig.name}] Gas price too high, waiting...`);
          await new Promise(resolve => setTimeout(resolve, GLOBAL_CONFIG.RETRY_DELAY));
          continue;
        }

        const now = Date.now();
        const eligibleWallets = this.tempWallets.filter(wallet =>
          this.activeWallets.has(wallet.address) &&
          now - wallet.lastTradeTime >= this.generateRandomDelay()
        );

        for (const wallet of eligibleWallets) {
          await this.executeTrade(wallet);
          await new Promise(resolve =>
            setTimeout(resolve, Math.floor(1000 + Math.random() * 2000))
          );
        }

        // Save updated wallet data
        fs.writeFileSync(this.walletFile, JSON.stringify(this.tempWallets, null, 2));
        
        await new Promise(resolve => setTimeout(resolve, GLOBAL_CONFIG.CHECK_INTERVAL));
      } catch (error) {
        console.error(`[${this.chainConfig.name}] Error in trading loop:`, error);
        await new Promise(resolve => setTimeout(resolve, GLOBAL_CONFIG.RETRY_DELAY));
      }
    }
  }

  async checkMainWalletBalance() {
    const balance = await this.provider.getBalance(this.mainWallet.address);
    const balanceETH = Number(ethers.utils.formatEther(balance));
    console.log(`[${this.chainConfig.name}] Main wallet balance: ${balanceETH} ETH`);
    
    if (balanceETH < GLOBAL_CONFIG.MIN_ETH_BALANCE) {
      throw new Error(`Insufficient balance in main wallet: ${balanceETH} ETH`);
    }
    return balanceETH;
  }

  async initialize() {
    try {
      await this.checkMainWalletBalance();
      await this.initializeTempWallets();
      console.log(`[${this.chainConfig.name}] Bot initialized successfully`);
    } catch (error) {
      console.error(`[${this.chainConfig.name}] Initialization error:`, error);
      throw error;
    }
  }
}

// Main execution
async function main() {
  try {
    // Read configuration from environment variables
    const MAIN_WALLET_PRIVATE_KEY = process.env.MAIN_WALLET_PRIVATE_KEY;
    const TEMP_WALLET_COUNT = parseInt(process.env.TEMP_WALLET_COUNT || "5");
    const CHAINS = (process.env.ACTIVE_CHAINS || "mainnet,base").split(",");

    if (!MAIN_WALLET_PRIVATE_KEY) {
      throw new Error("Main wallet private key not found in environment variables");
    }

    const bots = [];
    for (const chain of CHAINS) {
      if (CHAIN_CONFIG[chain]) {
        const bot = new MultiChainTradingBot(chain, MAIN_WALLET_PRIVATE_KEY, TEMP_WALLET_COUNT);
        await bot.initialize();
        bots.push(bot);
      }
    }

    await Promise.all(bots.map(bot => bot.startTrading()));
  } catch (error) {
    console.error("Fatal error:", error);
    process.exit(1);
  }
}

// Handle termination signals
process.on('SIGINT', async () => {
  console.log('\nGracefully shutting down...');
  // Could add cleanup logic here if needed
  process.exit(0);
});

process.on('SIGTERM', async () => {
  console.log('\nGracefully shutting down...');
  // Could add cleanup logic here if needed
  process.exit(0);
});

// Start the bot
main().catch(console.error);