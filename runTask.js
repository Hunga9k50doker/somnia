const fs = require("fs");
const path = require("path");
const axios = require("axios");
const colors = require("colors");
const { HttpsProxyAgent } = require("https-proxy-agent");
const readline = require("readline");
const user_agents = require("./config/userAgents");
const settings = require("./config/config.js");
const { sleep, loadData, getRandomNumber, saveToken, isTokenExpired, saveJson, decodeJWT, getRandomElement } = require("./utils.js");
const { Worker, isMainThread, parentPort, workerData } = require("worker_threads");
const { checkBaseUrl } = require("./checkAPI");
const { headers } = require("./core/header.js");
const { showBanner } = require("./core/banner.js");
const localStorage = require("./localStorage.json");
const { Wallet, ethers } = require("ethers");
const fetch = (...args) => import("node-fetch").then(({ default: fetch }) => fetch(...args));

class ClientAPI {
  constructor(itemData, accountIndex, proxy, baseURL, authInfo) {
    this.headers = headers;
    this.baseURL = baseURL;
    this.baseURL_v2 = settings.BASE_URL_V2;
    this.itemData = itemData;
    this.accountIndex = accountIndex;
    this.proxy = proxy;
    this.proxyIP = null;
    this.session_name = null;
    this.session_user_agents = this.#load_session_data();
    this.token = null;
    this.authInfo = authInfo;
    this.localStorage = localStorage;
    this.wallet = new ethers.Wallet(this.itemData);
  }

  #load_session_data() {
    try {
      const filePath = path.join(process.cwd(), "session_user_agents.json");
      const data = fs.readFileSync(filePath, "utf8");
      return JSON.parse(data);
    } catch (error) {
      if (error.code === "ENOENT") {
        return {};
      } else {
        throw error;
      }
    }
  }

  #get_random_user_agent() {
    const randomIndex = Math.floor(Math.random() * user_agents.length);
    return user_agents[randomIndex];
  }

  #get_user_agent() {
    if (this.session_user_agents[this.session_name]) {
      return this.session_user_agents[this.session_name];
    }

    console.log(`[Tài khoản ${this.accountIndex + 1}] Tạo user agent...`.blue);
    const newUserAgent = this.#get_random_user_agent();
    this.session_user_agents[this.session_name] = newUserAgent;
    this.#save_session_data(this.session_user_agents);
    return newUserAgent;
  }

  #save_session_data(session_user_agents) {
    const filePath = path.join(process.cwd(), "session_user_agents.json");
    fs.writeFileSync(filePath, JSON.stringify(session_user_agents, null, 2));
  }

  #get_platform(userAgent) {
    const platformPatterns = [
      { pattern: /iPhone/i, platform: "ios" },
      { pattern: /Android/i, platform: "android" },
      { pattern: /iPad/i, platform: "ios" },
    ];

    for (const { pattern, platform } of platformPatterns) {
      if (pattern.test(userAgent)) {
        return platform;
      }
    }

    return "Unknown";
  }

  #set_headers() {
    const platform = this.#get_platform(this.#get_user_agent());
    this.headers["sec-ch-ua"] = `Not)A;Brand";v="99", "${platform} WebView";v="127", "Chromium";v="127`;
    this.headers["sec-ch-ua-platform"] = platform;
    this.headers["User-Agent"] = this.#get_user_agent();
  }

  createUserAgent() {
    try {
      this.session_name = this.wallet.address;
      this.#get_user_agent();
    } catch (error) {
      this.log(`Can't create user agent: ${error.message}`, "error");
      return;
    }
  }

  async log(msg, type = "info") {
    const accountPrefix = `[Account ${this.accountIndex + 1}][${this.wallet.address}]`;
    let ipPrefix = "[Local IP]";
    if (settings.USE_PROXY) {
      ipPrefix = this.proxyIP ? `[${this.proxyIP}]` : "[Unknown IP]";
    }
    let logMessage = "";

    switch (type) {
      case "success":
        logMessage = `${accountPrefix}${ipPrefix} ${msg}`.green;
        break;
      case "error":
        logMessage = `${accountPrefix}${ipPrefix} ${msg}`.red;
        break;
      case "warning":
        logMessage = `${accountPrefix}${ipPrefix} ${msg}`.yellow;
        break;
      case "custom":
        logMessage = `${accountPrefix}${ipPrefix} ${msg}`.magenta;
        break;
      default:
        logMessage = `${accountPrefix}${ipPrefix} ${msg}`.blue;
    }
    console.log(logMessage);
  }

  async checkProxyIP() {
    try {
      const proxyAgent = new HttpsProxyAgent(this.proxy);
      const response = await axios.get("https://api.ipify.org?format=json", { httpsAgent: proxyAgent });
      if (response.status === 200) {
        this.proxyIP = response.data.ip;
        return response.data.ip;
      } else {
        throw new Error(`Cannot check proxy IP. Status code: ${response.status}`);
      }
    } catch (error) {
      throw new Error(`Error checking proxy IP: ${error.message}`);
    }
  }

  async makeRequest(
    url,
    method,
    data = {},
    options = {
      retries: 2,
      isAuth: false,
    }
  ) {
    const { retries, isAuth } = options;

    const headers = {
      ...this.headers,
    };

    if (!isAuth) {
      headers["authorization"] = `Bearer ${this.token}`;
    }

    let proxyAgent = null;
    if (settings.USE_PROXY) {
      proxyAgent = new HttpsProxyAgent(this.proxy);
    }
    let currRetries = 0;
    do {
      try {
        // const res = await fetch(url, {
        //   method,
        //   headers,
        //   timeout: 30000,
        //   ...(method.toLowerCase() !== "get" ? { body: JSON.stringify(data) } : {}),
        //   ...(proxyAgent ? { agent: proxyAgent } : {}),
        // });

        // const response = await res.json();
        // console.log(response.data);
        // if (!response.ok) {
        //   return { success: false, status: 500, data: null, error: "Unknow" };
        // }
        const response = await axios({
          method,
          url: `${url}`,
          headers,
          timeout: 30000,
          ...(method.toLowerCase() !== "get" ? { data: JSON.stringify(data) } : {}),
          ...(proxyAgent ? { httpsAgent: proxyAgent } : {}),
        });
        if (response?.data?.data) return { status: response.status, success: true, data: response.data.data };
        return { success: true, data: response.data, status: response.status };
      } catch (error) {
        this.log(`Request failed: ${url} | ${error.message}...`, "warning");
        if (error.message.includes("stream has been aborted")) {
          return { success: false, status: error.status, data: null, error: error.response.data.error || error.response.data.message || error.message };
        }
        if (error.status == 401) {
          const token = await this.getValidToken(true);
          if (!token) {
            process.exit(1);
          }
          this.token = token;
          return this.makeRequest(url, method, data, options);
        }
        if (error.status == 400) {
          console.log(this.token);
          this.log(`Invalid request for ${url}, maybe have new update from server | contact: https://t.me/airdrophuntersieutoc to get new update!`, "error");
          return { success: false, status: error.status, error: error.response.data.error || error.response.data.message || error.message };
        }
        if (error.status == 429) {
          this.log(`Rate limit ${error.message}, waiting 30s to retries`, "warning");
          await sleep(60);
        }
        await sleep(settings.DELAY_BETWEEN_REQUESTS);
      }
      currRetries++;
    } while (currRetries <= retries);
    return { status: error.status, success: false, error: error.message };
  }

  async auth() {
    const wallet = this.wallet;
    const message = { onboardingUrl: "https://quest.somnia.network" };
    const signedMessage = await wallet.signMessage(JSON.stringify(message));
    const payload = { signature: signedMessage, walletAddress: wallet.address };
    return this.makeRequest(`${this.baseURL}/auth/onboard`, "post", payload, { isAuth: true });
  }

  async getUserData() {
    return this.makeRequest(`${this.baseURL}/users/me`, "get");
  }

  async addRef() {
    const wallet = this.wallet;
    const message = { referralCode: settings.REF_CODE, product: "QUEST_PLATFORM" };
    const signedMessage = await wallet.signMessage(JSON.stringify(message));
    const payload = {
      referralCode: settings.REF_CODE,
      product: "QUEST_PLATFORM",
      signature: signedMessage,
    };
    return this.makeRequest(`${this.baseURL}/users/referrals`, "post", payload);
  }

  async getBalance() {
    return this.makeRequest(`${this.baseURL}/stats`, "get");
  }

  async getCampaigns() {
    return this.makeRequest(`${this.baseURL}/campaigns`, "get");
  }

  async getTransactions() {
    return this.makeRequest(`${this.baseURL_v2}/addresses/${this.wallet.address}/transactions`, "get");
  }

  async getCampaignDetail(id) {
    return this.makeRequest(`${this.baseURL}/campaigns/${id}`, "get");
  }

  async claimTaskSocial(payload, type) {
    return this.makeRequest(`${this.baseURL}/social/${type}`, "post", payload);
  }

  async claimTaskOnchain(payload, type) {
    return this.makeRequest(`${this.baseURL}/onchain/${type}`, "post", payload);
  }

  // async claimTask(payload, type) {
  //   return this.makeRequest(`${this.baseURL}/onchain/${type}`, "post", payload);
  // }

  async getRefs() {
    return this.makeRequest(`${this.baseURL}/referral/stats`, "get");
  }

  async sendMessage(payload) {
    return this.makeRequest(`${this.baseURL}/chat`, "post", payload);
  }

  async createNewThread(payload) {
    return this.makeRequest(`${this.baseURL}/chat`, "post", payload);
  }

  async getValidToken(isNew = false) {
    const existingToken = this.token;
    // const isExp = isTokenExpired(existingToken);
    if (existingToken && !isNew) {
      this.log("Using valid token", "success");
      return existingToken;
    } else {
      this.log("No found token or experied, trying get new token...", "warning");
      const loginRes = await this.auth();
      if (!loginRes.success) return null;
      const newToken = loginRes.data;
      if (newToken.token) {
        this.log("Get new token success!", "success");
        saveJson(this.session_name, newToken.token, "tokens.json");
        return newToken.token;
      }
      this.log("Can't get new token...", "warning");
      return null;
    }
  }

  async handleTasks() {
    let tasks = [];
    const transactionsRes = await this.getTransactions();
    const transactions = (transactionsRes.data.items || []).filter((item) => item.result == "success");

    const campaignsRes = await this.getCampaigns();
    if (!campaignsRes.success) return null;
    let campaigns = campaignsRes.data.filter((campaign) => settings.CAMPAIGNS.includes(campaign.id) && campaign.status === "OPEN");
    if (campaigns.length == 0) return this.log("No campaigns FOUND!", "warning");
    for (const campaign of campaigns) {
      this.log(`Checking task of campaign ${campaign.name}`);
      const resCampaignDetail = await this.getCampaignDetail(campaign.id);
      if (!resCampaignDetail.success) continue;
      tasks = [...tasks, ...resCampaignDetail.data.quests];
    }

    tasks = tasks.filter((c) => !settings.SKIP_TASKS.includes(c.id) && c.status === "OPEN" && !c.isParticipated);

    if (tasks.length == 0) return this.log("No tasks avaliable!", "warning");

    for (const task of tasks) {
      let txHash = null;
      let resClaimTask = null;
      await sleep(1);
      this.log(`Trying do task ID: ${task.id} | ${task.title}...`);
      const type = task.type.toLowerCase().replace(/_/g, "-");
      const payload = {
        questId: task.id,
      };
      if (type === "tx-hash") {
        if (task.title.includes("Receive STT")) {
          const trans = transactions.find((t) => t.to.hash == this.wallet.address && t.transaction_types[0] == "coin_transfer");
          if (trans) txHash = trans.hash;
        } else if (task.title.includes("Send STT")) {
          const trans = transactions.find((t) => t.from.hash == this.wallet.address && t.transaction_types[0] == "coin_transfer");
          if (trans) txHash = trans.hash;
        }
        if (!txHash) {
          this.log(`No found transaction for task ${task.title} (${task.id})`, "warning");
        }
        payload["txHash"] = txHash;
      }

      if (task.campaignId == 8) resClaimTask = await this.claimTaskSocial(payload, type);
      else resClaimTask = await this.claimTaskOnchain(payload, type);
      if (resClaimTask.success) {
        this.log(`Doing task ${task.id} |  ${task.title} | Thành công`, "success");
      } else {
        this.log(`Doing task ${task.id} |  ${task.title} | Thất bại`, "error");
      }
    }
  }
  async handleSyncData() {
    let userData = { success: false, data: null, status: 0 },
      retries = 0;
    do {
      userData = await this.getUserData();
      if (userData?.success) break;
      retries++;
    } while (retries < 1 && userData.status !== 400);
    const balanceData = await this.getBalance();
    if (userData.success && balanceData.success) {
      const { finalPoints, rank, streakCount, totalPoints, seasonId } = balanceData.data;
      const { discordName, referralCode, username, twitterName } = userData.data;

      this.log(
        `Username: ${username || "Not set"} | Ref code: ${referralCode} | Login streak: ${streakCount} | Rank: ${rank || "Đáy xã hội"} | Season ${seasonId}: ${totalPoints} points | Total Points: ${
          finalPoints || 0
        }`,
        "custom"
      );

      if (referralCode != settings.REF_CODE) {
        // await this.addRef();
      }
    } else {
      return this.log("Can't sync new data...skipping", "warning");
    }
    return userData;
  }

  async runAccount() {
    const accountIndex = this.accountIndex;
    this.session_name = this.wallet.address;
    this.token = this.authInfo[this.session_name];
    this.#set_headers();
    if (settings.USE_PROXY) {
      try {
        this.proxyIP = await this.checkProxyIP();
      } catch (error) {
        this.log(`Cannot check proxy IP: ${error.message}`, "warning");
        return;
      }
      const timesleep = getRandomNumber(settings.DELAY_START_BOT[0], settings.DELAY_START_BOT[1]);
      console.log(`=========Tài khoản ${accountIndex + 1} | ${this.proxyIP} | Bắt đầu sau ${timesleep} giây...`.green);
      await sleep(timesleep);
    }

    const token = await this.getValidToken();
    if (!token) return;
    this.token = token;
    const userData = await this.handleSyncData();
    if (userData.success) {
      await this.handleTasks();
      await sleep(1);
      // await this.handleSyncData();
    } else {
      return this.log("Can't get use info...skipping", "error");
    }
  }
}

async function runWorker(workerData) {
  const { itemData, accountIndex, proxy, hasIDAPI, authInfo } = workerData;
  const to = new ClientAPI(itemData, accountIndex, proxy, hasIDAPI, authInfo);
  try {
    await Promise.race([to.runAccount(), new Promise((_, reject) => setTimeout(() => reject(new Error("Timeout")), 24 * 60 * 60 * 1000))]);
    parentPort.postMessage({
      accountIndex,
    });
  } catch (error) {
    parentPort.postMessage({ accountIndex, error: error.message });
  } finally {
    if (!isMainThread) {
      parentPort.postMessage("taskComplete");
    }
  }
}

async function main() {
  showBanner();
  // fs.writeFile("./tokens.json", JSON.stringify({}), (err) => {});
  // await sleep(1);
  const privateKeys = loadData("privateKeys.txt");
  const proxies = loadData("proxies.txt");
  let authInfo = require("./tokens.json");
  const data = privateKeys.map((item) => (item.startsWith("0x") ? item : `0x${item}`)).reverse();
  if (data.length == 0 || (data.length > proxies.length && settings.USE_PROXY)) {
    console.log("Số lượng proxy và data phải bằng nhau.".red);
    console.log(`Data: ${data.length}`);
    console.log(`Proxy: ${proxies.length}`);
    process.exit(1);
  }
  if (!settings.USE_PROXY) {
    console.log(`You are running bot without proxies!!!`.yellow);
  }
  let maxThreads = settings.USE_PROXY ? settings.MAX_THEADS : settings.MAX_THEADS_NO_PROXY;

  const { endpoint, message } = await checkBaseUrl();
  if (!endpoint) return console.log(`Không thể tìm thấy ID API, thử lại sau!`.red);
  console.log(`${message}`.yellow);
  // process.exit();
  data.map((val, i) => new ClientAPI(val, i, proxies[i], endpoint, {}).createUserAgent());
  await sleep(1);
  while (true) {
    authInfo = require("./tokens.json");
    let currentIndex = 0;
    const errors = [];
    while (currentIndex < data.length) {
      const workerPromises = [];
      const batchSize = Math.min(maxThreads, data.length - currentIndex);
      for (let i = 0; i < batchSize; i++) {
        const worker = new Worker(__filename, {
          workerData: {
            hasIDAPI: endpoint,
            itemData: data[currentIndex],
            accountIndex: currentIndex,
            proxy: proxies[currentIndex % proxies.length],
            authInfo: authInfo,
          },
        });

        workerPromises.push(
          new Promise((resolve) => {
            worker.on("message", (message) => {
              if (message === "taskComplete") {
                worker.terminate();
              }
              if (settings.ENABLE_DEBUG) {
                console.log(message);
              }
              resolve();
            });
            worker.on("error", (error) => {
              console.log(`Lỗi worker cho tài khoản ${currentIndex}: ${error.message}`);
              worker.terminate();
              resolve();
            });
            worker.on("exit", (code) => {
              worker.terminate();
              if (code !== 0) {
                errors.push(`Worker cho tài khoản ${currentIndex} thoát với mã: ${code}`);
              }
              resolve();
            });
          })
        );

        currentIndex++;
      }

      await Promise.all(workerPromises);

      if (errors.length > 0) {
        errors.length = 0;
      }

      if (currentIndex < data.length) {
        await new Promise((resolve) => setTimeout(resolve, 3000));
      }
    }

    await sleep(3);
    console.log(`=============${new Date().toLocaleString()} | Hoàn thành tất cả tài khoản | Chờ ${settings.TIME_SLEEP} phút=============`.magenta);
    showBanner();
    await sleep(settings.TIME_SLEEP * 60);
  }
}

if (isMainThread) {
  main().catch((error) => {
    console.log("Lỗi rồi:", error);
    process.exit(1);
  });
} else {
  runWorker(workerData);
}
