const fs = require("fs");
const path = require("path");
const inquirer = require("inquirer");
const ethers = require("ethers");
const { loadData } = require("./utils");

const walletsFile = path.join("./utils", "wallets.json");

const loadWallets = () => {
  if (!fs.existsSync(walletsFile)) {
    fs.writeFileSync(walletsFile, JSON.stringify([]));
  }
  const data = fs.readFileSync(walletsFile, "utf-8");
  return JSON.parse(data);
};

const saveWallets = (wallets) => {
  fs.writeFileSync(walletsFile, JSON.stringify(wallets, null, 2));
};

const addWallet = async (privateKey, wallets) => {
  try {
    const walletObj = new ethers.Wallet(privateKey);
    const address = walletObj.address;
    const isFound = wallets.findIndex((w) => w.address === address);
    if (isFound >= 0) {
      return null;
    }
    console.log(`🔍 Wallet Found is [${address}]`);
    console.log("✔️  Wallet Has been added");
    return {
      id: address,
      address: address,
      privateKey: walletObj.privateKey,
    };
  } catch (error) {
    console.error("⚠️", error.message);
    return null;
  }
};

const main = async () => {
  const wallets = loadWallets();
  const privateKeys = loadData("privateKeys.txt");
  for (const privateKey of privateKeys) {
    const prvk = privateKey.startsWith("0x") ? privateKey : `0x${privateKey}`;
    const data = await addWallet(prvk, wallets);
    if (!data) continue;
    wallets.push(data);
    saveWallets(wallets);
  }
};

main();
