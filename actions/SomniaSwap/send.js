const fs = require("fs");
const path = require("path");
const inquirer = require("inquirer");
const { ethers } = require("ethers");
const colors = require("colors");

const chain = require("../../utils/chain.js");
const { ABI, PONG_CONTRACT, PING_CONTRACT, ROUTER_CONTRACT } = require("./ABI.js");
const settings = require("../../config/config.js");
const { getRandomElement } = require("../../utils.js");

let wallets = [];
try {
  const walletsPath = path.join(__dirname, "..", "..", "utils", "wallets.json");
  wallets = JSON.parse(fs.readFileSync(walletsPath, "utf8"));
} catch (error) {
  console.error("Error reading wallets.json:".red, error);
  process.exit(1);
}

const provider = new ethers.providers.JsonRpcProvider(chain.RPC_URL, chain.CHAIN_ID);
const tokens = [
  { name: "PONG", address: PONG_CONTRACT },
  { name: "PING", address: PING_CONTRACT },
];

async function getTokenBalance(tokenAddress, walletAddress) {
  const tokenContract = new ethers.Contract(tokenAddress, ERC20_ABI, provider);
  const [rawBalance, decimals] = await Promise.all([tokenContract.balanceOf(walletAddress), tokenContract.decimals()]);
  return Number(ethers.utils.formatUnits(rawBalance, decimals));
}

async function getTokenDecimals(tokenAddress) {
  const tokenContract = new ethers.Contract(tokenAddress, ERC20_ABI, provider);
  return tokenContract.decimals();
}

async function processWallet(wallet) {
  const signer = new ethers.Wallet(wallet.privateKey, provider);
  const walletAddress = wallet.address;
  let randomWallet = getRandomElement(wallets);

  while (randomWallet.address === walletAddress) {
    randomWallet = getRandomElement(wallets);
  }

  const nativeBalanceBN = await provider.getBalance(walletAddress);
  if (nativeBalanceBN.isZero()) {
    console.log(`⚠️  Wallet [${wallet.id}] doesn't own Balances in Tokens to send (0 STT).`.red);
    return;
  }

  const minSw = settings.AMOUNT[0];
  const maxSw = settings.AMOUNT[1];
  const amount = Math.floor(Math.random() * (maxSw - minSw + 1)) + minSw;

  // Kiểm tra số dư đủ để gửi
  const gasPrice = await provider.getGasPrice();
  const estimatedGas = ethers.utils.hexlify(21000); // Phí gas cho giao dịch đơn giản
  const totalCost = ethers.BigNumber.from(estimatedGas)
    .mul(gasPrice)
    .add(ethers.utils.parseEther(amount.toFixed(4)));

  if (nativeBalanceBN.lt(totalCost)) {
    console.log(`⚠️  Wallet [${wallet.id}] doesn't have enough balance to cover gas fees and send amount.`.red);
    return;
  }

  console.log(`🔄 Sending ${amount} STT from ${wallet.address} to ${randomWallet.address}...`.yellow);
  const tx = await signer.sendTransaction({
    to: randomWallet.address,
    value: ethers.utils.parseEther(amount.toFixed(4)),
  });

  try {
    const receipt = await tx.wait();
    console.log(`🔗 Transaction Sent! ${chain.TX_EXPLORER}${tx.hash}`.magenta);
    console.log(`✅ Tx Confirmed in Block - ${receipt.blockNumber}`.green);
  } catch (error) {
    console.error(`❌ Error executing transaction: ${error.message}`.red);
    return;
  }
}

async function main() {
  for (const wallet of wallets) {
    await processWallet(wallet);
  }
  console.log("\nAll done! Exiting send.js".green);
}

main();
