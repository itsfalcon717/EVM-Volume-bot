# MultiChain Volume Bot

A configurable automated trading bot that executes trades across multiple blockchain networks (Ethereum Mainnet and Base) using Uniswap. The bot creates and manages multiple temporary wallets to distribute trading activity and implements various safety features like gas price checks and slippage protection.

## Features

- Multi-chain support (Ethereum Mainnet and Base)
- Distributed trading across multiple temporary wallets
- Automated wallet funding and fund recovery
- Random trade amounts and intervals
- Gas price monitoring and protection
- Slippage calculation and protection
- Configurable trading parameters per chain
- Automatic wallet rotation
- Safe shutdown handling

## Prerequisites

- Node.js (v14 or higher)
- npm or yarn
- Access to Ethereum and Base RPC endpoints
- ETH in your main wallet for trading

## Installation

1. Clone the repository:
```bash
git clone <repository-url>
cd EVM-Volume-bot
```

2. Install dependencies:
```bash
npm install
```

3. Create a `.env` file in the project root with the following variables:
```env
# Wallet Configuration
MAIN_WALLET_PRIVATE_KEY=your_private_key_here
TEMP_WALLET_COUNT=5

# RPC Endpoints
ETH_MAINNET_RPC_URL=your_mainnet_rpc_url
BASE_RPC_URL=your_base_rpc_url

# Target Token Addresses
MAINNET_TARGET_TOKEN=your_mainnet_token_address
BASE_TARGET_TOKEN=your_base_token_address

# Optional Configuration
ACTIVE_CHAINS=mainnet,base  # Comma-separated list of chains to trade on
```

## Configuration

The bot can be configured through both environment variables and the `CHAIN_CONFIG` object in the code:

### Chain-Specific Configuration (in code)
```javascript
mainnet: {
  maxGasPrice: 50, // Maximum gas price in gwei
  tradingParams: {
    minAmountETH: 0.1,    // Minimum trade amount
    maxAmountETH: 0.3,    // Maximum trade amount
    minInterval: 10 * 60 * 1000,  // Minimum time between trades
    maxInterval: 20 * 60 * 1000,  // Maximum time between trades
    gasMultiplier: 1.1,   // Gas price multiplier
    fundAmount: 0.5       // Amount to fund each temp wallet
  }
}
```

### Global Configuration (in code)
```javascript
GLOBAL_CONFIG = {
  RANDOM_VARIANCE: 0.01,           // Trade amount variance
  MIN_ETH_BALANCE: 0.01,          // Minimum ETH balance to maintain
  ACTIVE_WALLET_PERCENTAGE: 0.7,   // Percentage of wallets to keep active
  WALLET_FUND_THRESHOLD: 0.05      // Minimum balance before refunding
}
```

## Usage

1. Start the bot:
```bash
npm start
```

2. Monitor the console output for trading activity and errors.

3. To stop the bot gracefully, press `Ctrl+C` or send a SIGTERM signal.

## Safety Features

- **Gas Price Protection**: Trades only execute when gas prices are below configured thresholds
- **Slippage Protection**: Calculates expected output and sets minimum received amount
- **Balance Management**: Automatically manages wallet funding and recovery
- **Error Handling**: Comprehensive error handling and retry mechanisms
- **Distributed Trading**: Spreads trading activity across multiple wallets
- **Random Delays**: Implements random delays between trades to avoid pattern detection

## Wallet Management

The bot creates and manages temporary wallets for trading:
- Temporary wallet information is stored in `temp_wallets_{chainName}.json`
- Wallets are automatically funded from the main wallet when needed
- Excess funds are automatically returned to the main wallet
- Only a percentage of wallets are active at any time
- Wallet rotation occurs randomly to distribute activity

## Trading Strategy

The bot implements a simple trading strategy:
- Randomly chooses between buying and selling (if tokens are available)
- Uses random trade amounts within configured ranges
- Implements random delays between trades
- Calculates slippage and sets appropriate minimums
- Manages token approvals automatically
- Returns excess ETH to main wallet after sells

## Warning

This is a trading bot that involves real cryptocurrency transactions. Please ensure you:
- Thoroughly test with small amounts first
- Understand all risks involved
- Monitor the bot's activity regularly
- Keep your private keys secure
- Have sufficient funds for gas fees

## Contributing

Contributions are welcome! Please feel free to submit a Pull Request.

## License

[MIT License](LICENSE)
