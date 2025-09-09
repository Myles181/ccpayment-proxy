const express = require("express");
const { createProxyMiddleware } = require("http-proxy-middleware");
const cors = require("cors");
const axios = require("axios");
const crypto = require("crypto");

const app = express();

// Enable CORS for all routes
app.use(
  cors({
    origin: [
      "http://localhost:8080",
      "https://localhost:8080",
      "https://invest.fluxel.app",
      "https://www.invest.fluxel.app",
      "https://lovable.dev",
      "https://www.lovable.dev",
    ],
    methods: ["GET", "POST", "PUT", "DELETE", "OPTIONS"],
    allowedHeaders: [
      "Content-Type",
      "Authorization",
      "Appid",
      "Sign",
      "Timestamp",
    ],
  })
);

// Parse JSON bodies
app.use(express.json());

// Logging middleware
app.use((req, res, next) => {
  console.log(`${new Date().toISOString()} - ${req.method} ${req.path}`);
  next();
});

// Health check endpoint
app.get("/", (req, res) => {
  res.json({
    status: "CCPayment Proxy Server Running",
    timestamp: new Date().toISOString(),
    message: "Ready to proxy requests to CCPayment API",
  });
});

app.get("/health", (req, res) => {
  res.json({
    status: "healthy",
    uptime: process.uptime(),
    timestamp: new Date().toISOString(),
  });
});

// Get outbound IP endpoint
app.get("/get-ip", async (req, res) => {
  try {
    const response = await axios.get("https://api.ipify.org?format=json");
    res.json({
      outbound_ip: response.data.ip,
      timestamp: new Date().toISOString(),
      message: "This is the IP address that CCPayment will see",
    });
  } catch (error) {
    res.status(500).json({
      error: "Failed to get IP",
      message: error.message,
    });
  }
});

// CCPayment wallet generation endpoint
app.post("/generate-wallet", async (req, res) => {
  try {
    console.log("🔥 CCPayment proxy /generate-wallet endpoint hit");
    console.log("📦 Request body received:", JSON.stringify(req.body, null, 2));

    const { userId, chain, currency } = req.body;
    console.log("📋 Extracted parameters:", { userId, chain, currency });

    if (!userId || !chain || !currency) {
      console.log("❌ Missing required parameters:", {
        hasUserId: !!userId,
        hasChain: !!chain,
        hasCurrency: !!currency,
      });
      return res.status(400).json({
        success: false,
        error: "User ID, chain, and currency are required",
      });
    }

    // Get CCPayment credentials from environment variables
    const appId = process.env.CCPAYMENT_APP_ID;
    const appSecret = process.env.CCPAYMENT_APP_SECRET;

    if (!appId || !appSecret) {
      console.error("Missing CCPayment credentials");
      return res.status(500).json({
        success: false,
        error: "CCPayment credentials not configured",
      });
    }

    // Generate orderId that includes userId for webhook processing
    const orderId = `deposit_${userId}_${Math.floor(Date.now() / 1000)}`;

    // Get coinId based on currency (USDT = 1280 according to your API response)
    const coinId = currency === "USDT" ? 1280 : 1280; // Default to USDT for now

    // Prepare request data for createAppOrderDepositAddress
    const args = JSON.stringify({
      coinId: coinId,
      price: "1", // Minimum price as per CCPayment docs
      orderId: orderId,
      chain: chain,
    });
    const timestamp = Math.floor(Date.now() / 1000);

    // Create signature
    let signText = appId + timestamp;
    if (args) {
      signText += args;
    }

    const sign = crypto
      .createHmac("sha256", appSecret)
      .update(signText)
      .digest("hex");

    console.log("Making CCPayment request with:", {
      userId,
      chain,
      currency,
      coinId,
      orderId,
      timestamp,
      appId: appId.substring(0, 8) + "...", // Log partial appId for debugging
    });

    // Make request to CCPayment
    const ccpaymentResponse = await axios.post(
      "https://ccpayment.com/ccpayment/v2/createAppOrderDepositAddress",
      args,
      {
        headers: {
          "Content-Type": "application/json",
          Appid: appId,
          Sign: sign,
          Timestamp: timestamp.toString(),
        },
        timeout: 30000, // 30 second timeout
      }
    );

    console.log("CCPayment response:", ccpaymentResponse.data);

    if (ccpaymentResponse.data.code === 10000) {
      res.json({
        success: true,
        data: {
          address: ccpaymentResponse.data.data.address,
          memo: ccpaymentResponse.data.data.memo || "",
          amount: ccpaymentResponse.data.data.amount,
          checkoutUrl: ccpaymentResponse.data.data.checkoutUrl,
          confirmsNeeded: ccpaymentResponse.data.data.confirmsNeeded,
          chain,
          currency,
          userId,
          orderId,
        },
        message: "Wallet address generated successfully",
      });
    } else {
      console.error("CCPayment error:", ccpaymentResponse.data);
      res.status(400).json({
        success: false,
        error:
          ccpaymentResponse.data.msg || "Failed to generate wallet address",
        code: ccpaymentResponse.data.code,
      });
    }
  } catch (error) {
    console.error("Error generating wallet:", error);

    if (error.response) {
      console.error("CCPayment API response error:", error.response.data);
      res.status(error.response.status || 500).json({
        success: false,
        error: error.response.data?.msg || "CCPayment API error",
        details: error.response.data,
      });
    } else if (error.request) {
      console.error("Network error:", error.message);
      res.status(500).json({
        success: false,
        error: "Network error connecting to CCPayment",
        details: error.message,
      });
    } else {
      console.error("Unexpected error:", error.message);
      res.status(500).json({
        success: false,
        error: "Unexpected error occurred",
        details: error.message,
      });
    }
  }
});

// Test IP endpoint - makes actual request to see what IP is used
app.get("/test-ip", async (req, res) => {
  try {
    console.log("Testing actual outbound IP by making external request...");

    // Make multiple requests to different IP detection services
    const ipServices = [
      "https://api.ipify.org?format=json",
      "https://httpbin.org/ip",
      "https://api.myip.com",
    ];

    const results = [];

    for (const service of ipServices) {
      try {
        const response = await axios.get(service, { timeout: 5000 });
        console.log(`IP from ${service}:`, response.data);
        results.push({
          service,
          data: response.data,
          status: "success",
        });
      } catch (error) {
        console.log(`Failed to get IP from ${service}:`, error.message);
        results.push({
          service,
          error: error.message,
          status: "failed",
        });
      }
    }

    res.json({
      message: "IP detection test results",
      timestamp: new Date().toISOString(),
      results,
    });
  } catch (error) {
    res.status(500).json({
      error: "Failed to test IP",
      message: error.message,
    });
  }
});

// Get deposit record endpoint - for webhooks to fetch deposit details
app.post("/get-deposit-record", async (req, res) => {
  try {
    const { recordId } = req.body;

    if (!recordId) {
      return res.status(400).json({
        success: false,
        error: "recordId is required",
      });
    }

    console.log(`🔍 Fetching deposit record for recordId: ${recordId}`);

    const appId = process.env.CCPAYMENT_APP_ID;
    const appSecret = process.env.CCPAYMENT_APP_SECRET;

    if (!appId || !appSecret) {
      console.error("❌ CCPayment credentials not configured");
      return res.status(500).json({
        success: false,
        error: "CCPayment credentials not configured",
      });
    }

    // Prepare the request payload
    const args = JSON.stringify({ recordId });

    // Create signature
    const timestamp = Math.floor(Date.now() / 1000);
    let signText = appId + timestamp;
    if (args.length !== 0) {
      signText += args;
    }

    const sign = crypto
      .createHmac("sha256", appSecret)
      .update(signText)
      .digest("hex");

    console.log(`📝 Making request to CCPayment API with signature`);

    // Make the API request
    const response = await axios.post(
      "https://ccpayment.com/ccpayment/v2/getAppDepositRecord",
      { recordId },
      {
        headers: {
          "Content-Type": "application/json",
          Appid: appId,
          Sign: sign,
          Timestamp: timestamp.toString(),
        },
      }
    );

    console.log(`✅ CCPayment API response:`, response.data);

    if (response.data.code !== 10000) {
      return res.status(400).json({
        success: false,
        error: response.data.msg || "CCPayment API error",
        ccpaymentResponse: response.data,
      });
    }

    res.json({
      success: true,
      data: response.data.data?.record || null,
      ccpaymentResponse: response.data,
    });
  } catch (error) {
    console.error("❌ Error in get-deposit-record:", error);
    res.status(500).json({
      success: false,
      error: error.message,
      details: error.response?.data || "Unknown error",
    });
  }
});

// Create withdrawal to blockchain network endpoint
app.post("/create-withdrawal", async (req, res) => {
  try {
    // Extract and validate auth token
    const authHeader = req.headers.authorization;
    if (!authHeader || !authHeader.startsWith("Bearer ")) {
      return res.status(401).json({
        success: false,
        error: "Authentication required",
      });
    }

    const token = authHeader.substring(7); // Remove 'Bearer ' prefix

    // Validate token with Supabase
    const supabaseUrl = process.env.SUPABASE_URL;
    const supabaseKey = process.env.SUPABASE_ANON_KEY;

    if (!supabaseUrl || !supabaseKey) {
      console.error("❌ Supabase configuration missing");
      return res.status(500).json({
        success: false,
        error: "Server configuration error",
      });
    }

    // Verify user authentication
    const userResponse = await fetch(`${supabaseUrl}/auth/v1/user`, {
      headers: {
        Authorization: `Bearer ${token}`,
        apikey: supabaseKey,
      },
    });

    if (!userResponse.ok) {
      return res.status(401).json({
        success: false,
        error: "Invalid authentication token",
      });
    }

    const userData = await userResponse.json();
    const userId = userData.id;

    console.log(`🔐 Authenticated user: ${userId}`);

    const { chain, address, amount, orderId, memo } = req.body;

    // coinId is always 1280 (constant)
    const coinId = 1280;

    // merchantPayNetworkFee is always false
    const merchantPayNetworkFee = false;

    if (!chain || !address || !amount || !orderId) {
      return res.status(400).json({
        success: false,
        error: "Missing required parameters: chain, address, amount, orderId",
      });
    }

    console.log(
      `💸 Creating network withdrawal: address=${address}, amount=${amount}, coinId=${coinId}, chain=${chain}`
    );

    const appId = process.env.CCPAYMENT_APP_ID;
    const appSecret = process.env.CCPAYMENT_APP_SECRET;
    let newChain;
    if (chain === "TRC20") {
      newChain = "TRX";
    } else if (chain === "BEP20") {
      newChain = "BSC";
    } else if (chain === "ERC20") {
      newChain = "ETH";
    } else {
      newChain = chain; // Use as-is for other chains
    }

    if (!appId || !appSecret) {
      console.error("❌ CCPayment credentials not configured");
      return res.status(500).json({
        success: false,
        error: "CCPayment credentials not configured",
      });
    }

    // Prepare the request payload
    const payload = {
      coinId: coinId, // Always 1280
      chain: newChain,
      address: address,
      amount: amount.toString(),
      orderId: orderId,
      merchantPayNetworkFee: merchantPayNetworkFee, // Always false
    };

    // Add optional parameters if provided
    if (memo) payload.memo = memo;

    const args = JSON.stringify(payload);

    // Create signature
    const timestamp = Math.floor(Date.now() / 1000);
    let signText = appId + timestamp;
    if (args.length !== 0) {
      signText += args;
    }

    const sign = crypto
      .createHmac("sha256", appSecret)
      .update(signText)
      .digest("hex");

    console.log(`📝 Making network withdrawal request to CCPayment API`);

    // Make the API request with retry logic for timeout handling
    let response;
    let retryCount = 3;

    while (retryCount > 0) {
      try {
        response = await axios.post(
          "https://ccpayment.com/ccpayment/v2/applyAppWithdrawToNetwork",
          payload,
          {
            headers: {
              "Content-Type": "application/json",
              Appid: appId,
              Sign: sign,
              Timestamp: timestamp.toString(),
            },
            timeout: 15000, // 15 second timeout
          }
        );
        break; // Success, exit retry loop
      } catch (error) {
        if (error.code === "ECONNABORTED" && retryCount > 1) {
          console.log(
            `⏰ Request timeout, retrying... (${retryCount - 1} attempts left)`
          );
          retryCount--;
          await new Promise((resolve) => setTimeout(resolve, 200)); // Wait 200ms before retry
          continue;
        }
        throw error; // Re-throw if not a timeout or no retries left
      }
    }

    console.log(`✅ CCPayment withdrawal response:`, response.data);

    if (response.data.code !== 10000) {
      return res.status(400).json({
        success: false,
        error: response.data.msg || "CCPayment withdrawal error",
        ccpaymentResponse: response.data,
      });
    }

    res.json({
      success: true,
      data: response.data.data,
      recordId: response.data.data?.recordId,
      ccpaymentResponse: response.data,
    });
  } catch (error) {
    console.error("❌ Error in create-withdrawal:", error);

    // Handle timeout errors specially
    if (error.code === "ECONNABORTED") {
      return res.status(408).json({
        success: false,
        error:
          "Request timeout - please check withdrawal status using the orderId",
        orderId: req.body.orderId,
        details: "Network timeout occurred, withdrawal may still be processing",
      });
    }

    return res.status(500).json({
      success: false,
      error: error.message,
      details: error.response?.data || "Unknown error",
    });
  }
});


// Admin approve withdrawal endpoint - processes the actual withdrawal
app.post("/admin-approve-withdrawal", async (req, res) => {
  try {
    // Extract and validate admin auth token
    const authHeader = req.headers.authorization;
    if (!authHeader || !authHeader.startsWith("Bearer ")) {
      return res.status(401).json({
        success: false,
        error: "Authentication required",
      });
    }

    const token = authHeader.substring(7);

    // Validate token with Supabase
    const supabaseUrl = process.env.SUPABASE_URL;
    const supabaseKey = process.env.SUPABASE_ANON_KEY;

    if (!supabaseUrl || !supabaseKey) {
      console.error("❌ Supabase configuration missing");
      return res.status(500).json({
        success: false,
        error: "Server configuration error",
      });
    }

    // Verify admin authentication
    const userResponse = await fetch(`${supabaseUrl}/auth/v1/user`, {
      headers: {
        Authorization: `Bearer ${token}`,
        apikey: supabaseKey,
      },
    });

    if (!userResponse.ok) {
      return res.status(401).json({
        success: false,
        error: "Invalid authentication token",
      });
    }

    const userData = await userResponse.json();

    // Check if user is admin
    if (userData.role !== "admin") {
      return res.status(403).json({
        success: false,
        error: "Admin access required",
      });
    }

    console.log(`🔐 Authenticated admin: ${userData.email}`);

    console.log("Body:",req.body);
    const { chain, address, amount, orderId, memo, withdrawalId } = req.body;

    if (!chain || !address || !amount || !orderId || !withdrawalId) {
      return res.status(400).json({
        success: false,
        error:
          "Missing required parameters: chain, address, amount, orderId, withdrawalId",
      });
    }

    console.log(
      `💸 Admin approving withdrawal: withdrawalId=${withdrawalId}, address=${address}, amount=${amount}, chain=${chain}`
    );

    const appId = process.env.CCPAYMENT_APP_ID;
    const appSecret = process.env.CCPAYMENT_APP_SECRET;
    let newChain;
    if (chain === "TRC20") {
      newChain = "TRX";
    } else if (chain === "BEP20") {
      newChain = "BSC";
    } else if (chain === "ERC20") {
      newChain = "ETH";
    } else {
      newChain = chain; // Use as-is for other chains
    }

    if (!appId || !appSecret) {
      console.error("❌ CCPayment credentials not configured");
      return res.status(500).json({
        success: false,
        error: "CCPayment credentials not configured",
      });
    }

    const payload = {
      coinId: 1280, // Always USDT
      chain: newChain,
      address: address,
      amount: amount.toString(),
      orderId: orderId,
      merchantPayNetworkFee: false,
    };

    // Add optional parameters
    if (memo) payload.memo = memo;

    const args = JSON.stringify(payload);

    // Create signature
    const timestamp = Math.floor(Date.now() / 1000);
    let signText = appId + timestamp;
    if (args.length !== 0) {
      signText += args;
    }

    const sign = crypto
      .createHmac("sha256", appSecret)
      .update(signText)
      .digest("hex");

    console.log(`📝 Making CCPayment API request for admin approval`);

    // Make the API request with retry logic
    let response;
    let retryCount = 3;

    while (retryCount > 0) {
      try {
        response = await axios.post(
          "https://ccpayment.com/ccpayment/v2/applyAppWithdrawToNetwork",
          payload,
          {
            headers: {
              "Content-Type": "application/json",
              Appid: appId,
              Sign: sign,
              Timestamp: timestamp.toString(),
            },
            timeout: 15000,
          }
        );
        break;
      } catch (error) {
        if (error.code === "ECONNABORTED" && retryCount > 1) {
          console.log(
            `⏰ Request timeout, retrying... (${retryCount - 1} attempts left)`
          );
          retryCount--;
          await new Promise((resolve) => setTimeout(resolve, 200));
          continue;
        }
        throw error;
      }
    }

    console.log(`✅ CCPayment admin approval response:`, response.data);

    if (response.data.code !== 10000) {
      return res.status(400).json({
        success: false,
        error: response.data.msg || "CCPayment withdrawal error",
        ccpaymentResponse: response.data,
      });
    }

    res.json({
      success: true,
      data: response.data.data,
      recordId: response.data.data?.recordId,
      ccpaymentResponse: response.data,
      withdrawalId: withdrawalId,
    });
  } catch (error) {
    console.error("❌ Error in admin-approve-withdrawal:", error);

    if (error.code === "ECONNABORTED") {
      return res.status(408).json({
        success: false,
        error: "Request timeout - withdrawal may still be processing",
        withdrawalId: req.body.withdrawalId,
        details: "Network timeout occurred",
      });
    }

    res.status(500).json({
      success: false,
      error: error.message,
      details: error.response?.data || "Unknown error",
    });
  }
});

// Admin reject withdrawal endpoint - no external processing needed
app.post("/admin-reject-withdrawal", async (req, res) => {
  try {
    // Extract and validate admin auth token
    const authHeader = req.headers.authorization;
    if (!authHeader || !authHeader.startsWith("Bearer ")) {
      return res.status(401).json({
        success: false,
        error: "Authentication required",
      });
    }

    const token = authHeader.substring(7);

    // Validate token with Supabase
    const supabaseUrl = process.env.SUPABASE_URL;
    const supabaseKey = process.env.SUPABASE_ANON_KEY;

    if (!supabaseUrl || !supabaseKey) {
      console.error("❌ Supabase configuration missing");
      return res.status(500).json({
        success: false,
        error: "Server configuration error",
      });
    }

    // Verify admin authentication
    const userResponse = await fetch(`${supabaseUrl}/auth/v1/user`, {
      headers: {
        Authorization: `Bearer ${token}`,
        apikey: supabaseKey,
      },
    });

    if (!userResponse.ok) {
      return res.status(401).json({
        success: false,
        error: "Invalid authentication token",
      });
    }

    const userData = await userResponse.json();

    // Check if user is admin
    if (userData.email !== "admin@3beetex.com") {
      return res.status(403).json({
        success: false,
        error: "Admin access required",
      });
    }

    console.log(`🔐 Admin rejecting withdrawal: ${userData.email}`);

    const { withdrawalId, reason } = req.body;

    if (!withdrawalId) {
      return res.status(400).json({
        success: false,
        error: "Missing required parameter: withdrawalId",
      });
    }

    console.log(
      `❌ Admin rejecting withdrawal: withdrawalId=${withdrawalId}, reason=${
        reason || "No reason provided"
      }`
    );

    // No external processing needed for rejection - just return success
    // The edge function will handle database updates and refunds
    res.json({
      success: true,
      withdrawalId: withdrawalId,
      action: "rejected",
      reason: reason || "Rejected by admin",
    });
  } catch (error) {
    console.error("❌ Error in admin-reject-withdrawal:", error);

    res.status(500).json({
      success: false,
      error: error.message,
      details: "Failed to process rejection",
    });
  }
});

// Get withdrawal record endpoint
app.post("/get-withdrawal-record", async (req, res) => {
  try {
    const { recordId, orderId } = req.body;

    if (!recordId && !orderId) {
      return res.status(400).json({
        success: false,
        error: "Either recordId or orderId is required",
      });
    }

    console.log(`🔍 Fetching withdrawal record for:`, { recordId, orderId });

    const appId = process.env.CCPAYMENT_APP_ID;
    const appSecret = process.env.CCPAYMENT_APP_SECRET;

    if (!appId || !appSecret) {
      console.error("❌ CCPayment credentials not configured");
      return res.status(500).json({
        success: false,
        error: "CCPayment credentials not configured",
      });
    }

    // Prepare the request payload
    const payload = {};
    if (recordId) payload.recordId = recordId;
    if (orderId) payload.orderId = orderId;

    const args = JSON.stringify(payload);

    // Create signature
    const timestamp = Math.floor(Date.now() / 1000);
    let signText = appId + timestamp;
    if (args.length !== 0) {
      signText += args;
    }

    const sign = crypto
      .createHmac("sha256", appSecret)
      .update(signText)
      .digest("hex");

    console.log(`📝 Making request to CCPayment withdrawal record API`);

    // Make the API request
    const response = await axios.post(
      "https://ccpayment.com/ccpayment/v2/getAppWithdrawRecord",
      payload,
      {
        headers: {
          "Content-Type": "application/json",
          Appid: appId,
          Sign: sign,
          Timestamp: timestamp.toString(),
        },
      }
    );

    console.log(`✅ CCPayment withdrawal record response:`, response.data);

    if (response.data.code !== 10000) {
      return res.status(400).json({
        success: false,
        error: response.data.msg || "CCPayment API error",
        ccpaymentResponse: response.data,
      });
    }

    res.json({
      success: true,
      data: response.data.data?.record || null,
      ccpaymentResponse: response.data,
    });
  } catch (error) {
    console.error("❌ Error in get-withdrawal-record:", error);
    res.status(500).json({
      success: false,
      error: error.message,
      details: error.response?.data || "Unknown error",
    });
  }
});

// Proxy configuration for CCPayment API
const ccpaymentProxy = createProxyMiddleware({
  target: "https://ccpayment.com",
  changeOrigin: true,
  secure: true,
  followRedirects: true,
  pathRewrite: {
    // Don't remove /ccpayment prefix - CCPayment API expects it
  },
  onProxyReq: (proxyReq, req, res) => {
    console.log(
      `Proxying ${req.method} request to: https://ccpayment.com${req.path}`
    );
    console.log("Request headers:", JSON.stringify(req.headers, null, 2));

    // CRITICAL: Remove all forwarding headers so CCPayment only sees our proxy IP
    proxyReq.removeHeader("x-forwarded-for");
    proxyReq.removeHeader("x-real-ip");
    proxyReq.removeHeader("x-forwarded-proto");
    proxyReq.removeHeader("x-forwarded-host");
    proxyReq.removeHeader("x-forwarded-port");
    proxyReq.removeHeader("forwarded");
    proxyReq.removeHeader("cf-connecting-ip"); // Cloudflare header
    proxyReq.removeHeader("true-client-ip"); // Cloudflare header
    proxyReq.removeHeader("x-client-ip");
    proxyReq.removeHeader("x-cluster-client-ip");

    console.log("🚫 Stripped all forwarding headers to mask original IP");
    console.log(
      "🎭 CCPayment will now see our proxy IP instead of Supabase IP"
    );

    // Log our current IP when making the request
    axios
      .get("https://api.ipify.org?format=json")
      .then((response) => {
        console.log(
          "🔍 Our current outbound IP when making CCPayment request:",
          response.data.ip
        );
      })
      .catch((error) => {
        console.log("Could not determine current IP:", error.message);
      });
  },
  onProxyRes: (proxyRes, req, res) => {
    console.log(`Received response from CCPayment: ${proxyRes.statusCode}`);
    console.log("Response headers:", JSON.stringify(proxyRes.headers, null, 2));

    // Capture and log the response body
    let body = "";
    proxyRes.on("data", (chunk) => {
      body += chunk;
    });
    proxyRes.on("end", () => {
      console.log("CCPayment Response Body:", body);
      console.log("Response Body Length:", body.length);

      // Try to parse and log structured JSON
      try {
        const jsonResponse = JSON.parse(body);
        console.log(
          "Parsed CCPayment Response:",
          JSON.stringify(jsonResponse, null, 2)
        );
        if (jsonResponse.code !== 10000) {
          console.error(
            "⚠️  CCPayment returned error code:",
            jsonResponse.code
          );
          console.error("⚠️  CCPayment error message:", jsonResponse.msg);
        } else {
          console.log("✅ CCPayment returned success code:", jsonResponse.code);
        }
      } catch (parseError) {
        console.log("Could not parse response as JSON:", parseError.message);
      }
    });
  },
  onError: (err, req, res) => {
    console.error("Proxy error:", err.message);
    res.status(500).json({
      error: "Proxy error",
      message: err.message,
      timestamp: new Date().toISOString(),
    });
  },
});

// Proxy configuration for CCPayment API domain (api.ccpayment.com)
const ccpaymentApiProxy = createProxyMiddleware({
  target: "https://api.ccpayment.com",
  changeOrigin: true,
  secure: true,
  followRedirects: true,
  pathRewrite: {
    "^/api": "", // Remove /api prefix when forwarding
  },
  onProxyReq: (proxyReq, req, res) => {
    console.log(
      `Proxying ${
        req.method
      } request to: https://api.ccpayment.com${req.path.replace("/api", "")}`
    );

    // CRITICAL: Remove all forwarding headers so CCPayment only sees our proxy IP
    proxyReq.removeHeader("x-forwarded-for");
    proxyReq.removeHeader("x-real-ip");
    proxyReq.removeHeader("x-forwarded-proto");
    proxyReq.removeHeader("x-forwarded-host");
    proxyReq.removeHeader("x-forwarded-port");
    proxyReq.removeHeader("forwarded");
    proxyReq.removeHeader("cf-connecting-ip");
    proxyReq.removeHeader("true-client-ip");
    proxyReq.removeHeader("x-client-ip");
    proxyReq.removeHeader("x-cluster-client-ip");

    console.log("🚫 Stripped forwarding headers for API proxy");
  },
  onProxyRes: (proxyRes, req, res) => {
    console.log(`Received response from CCPayment API: ${proxyRes.statusCode}`);
  },
  onError: (err, req, res) => {
    console.error("API Proxy error:", err.message);
    res.status(500).json({
      error: "API Proxy error",
      message: err.message,
      timestamp: new Date().toISOString(),
    });
  },
});

// Proxy configuration for CCPayment Admin API
const ccpaymentAdminProxy = createProxyMiddleware({
  target: "https://admin.ccpayment.com",
  changeOrigin: true,
  secure: true,
  followRedirects: true,
  pathRewrite: {
    "^/admin": "", // Remove /admin prefix when forwarding
  },
  onProxyReq: (proxyReq, req, res) => {
    console.log(
      `Proxying ${
        req.method
      } request to: https://admin.ccpayment.com${req.path.replace(
        "/admin",
        ""
      )}`
    );

    // CRITICAL: Remove all forwarding headers so CCPayment only sees our proxy IP
    proxyReq.removeHeader("x-forwarded-for");
    proxyReq.removeHeader("x-real-ip");
    proxyReq.removeHeader("x-forwarded-proto");
    proxyReq.removeHeader("x-forwarded-host");
    proxyReq.removeHeader("x-forwarded-port");
    proxyReq.removeHeader("forwarded");
    proxyReq.removeHeader("cf-connecting-ip");
    proxyReq.removeHeader("true-client-ip");
    proxyReq.removeHeader("x-client-ip");
    proxyReq.removeHeader("x-cluster-client-ip");

    console.log("🚫 Stripped forwarding headers for Admin proxy");
  },
  onProxyRes: (proxyRes, req, res) => {
    console.log(
      `Received response from CCPayment Admin: ${proxyRes.statusCode}`
    );
  },
  onError: (err, req, res) => {
    console.error("Admin Proxy error:", err.message);
    res.status(500).json({
      error: "Admin Proxy error",
      message: err.message,
      timestamp: new Date().toISOString(),
    });
  },
});

// Apply proxy middleware to routes
app.use("/ccpayment", ccpaymentProxy);
app.use("/api", ccpaymentApiProxy);
app.use("/admin", ccpaymentAdminProxy);

// Catch-all for debugging (must be after all specific routes)
app.use("*", (req, res) => {
  console.log(`Unhandled route: ${req.method} ${req.originalUrl}`);
  res.status(404).json({
    error: "Route not found",
    path: req.originalUrl,
    method: req.method,
    message: "Use /ccpayment/* to proxy to CCPayment API",
  });
});

const PORT = process.env.PORT || 3000;

app.listen(PORT, "0.0.0.0", () => {
  console.log(`🚀 CCPayment Proxy Server running on port ${PORT}`);
  console.log(`📡 Health check: http://localhost:${PORT}/health`);
  console.log(`🔄 Proxy endpoint: http://localhost:${PORT}/ccpayment/*`);
  console.log(
    `📝 Example: POST to /ccpayment/v2/getCoinList forwards to https://ccpayment.com/ccpayment/v2/getCoinList`
  );
});

// Graceful shutdown
process.on("SIGTERM", () => {
  console.log("SIGTERM received, shutting down gracefully");
  process.exit(0);
});

process.on("SIGINT", () => {
  console.log("SIGINT received, shutting down gracefully");
  process.exit(0);
});
