const express = require("express");
const multer = require("multer");
const fs = require("fs");
const { exec } = require("child_process");
const { spawn } = require("child_process");
const path = require("path");
require("dotenv").config(); // Load environment variables
const SimpleRequestLogger = require("./middleware/requestLogger");
// const fetch = require('node-fetch');
const rateLimit = require("express-rate-limit");
const crypto = require("crypto");
const os = require("os");

const app = express();
const port = process.env.PORT || 3000;

// ---- REQUEST SIZE LIMITS (GLOBAL) ----
app.use(express.json({ limit: "100kb" }));
app.use(express.urlencoded({ extended: false, limit: "100kb" }));

const globalLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 100, // 100 requests per IP per window
  standardHeaders: true,
  legacyHeaders: false,
});
app.use(globalLimiter);

// Initialize simple request logger
const requestLogger = new SimpleRequestLogger(process.env.DATABASE_URI);

// ---- MULTER CONFIG (SAFE LIMITS) ----
const upload = multer({
  storage: multer.memoryStorage(),
  limits: {
    fileSize: 100 * 1024, // 100 KB PER FILE
    files: 2, // max 2 files total
  },
}).fields([
  { name: "code", maxCount: 1 },
  { name: "input", maxCount: 1 },
]);

// ---- SAFE MULTER WRAPPER ----
function safeUpload(req, res, next) {
  upload(req, res, (err) => {
    if (err) {
      console.error("Multer error:", err.message);

      if (err.message === "Unexpected end of form") {
        return res.status(400).json({ error: "Incomplete form data" });
      }

      if (err.code === "LIMIT_FILE_SIZE") {
        return res.status(413).json({ error: "File too large" });
      }

      return res.status(400).json({ error: "Upload failed" });
    }
    next();
  });
}

// ---- RATE LIMITER FOR /COMPILE ----
const compileLimiter = rateLimit({
  windowMs: 60 * 1000, // 1 minute
  max: 30, // 30 requests per IP
  standardHeaders: true,
  legacyHeaders: false,
});

// Middleware setup
// app.use(express.json()); // Parse JSON bodies
app.use(requestLogger.middleware()); // Log all requests

app.post("/compile", compileLimiter, safeUpload, async (req, res) => {
  try {
    const lang = req.body.lang;
    const codeFile = req.files?.code?.[0];
    const inputFile = req.files?.input?.[0];

    if (!lang || !codeFile) {
      return res.status(400).json({ error: "Missing language or code file" });
    }

    // Load getCommand from Gist
    const gistUrl =
      "https://gist.githubusercontent.com/er-abhijeet/6d9caf2ecbc4976f750f07d973d36e20/raw/ba2167a3e345a9bb8f2a58795382ccda23641e2a/getCommand1.js";
    let getCommand;
    try {
      const response = await fetch(gistUrl);
      if (!response.ok) throw new Error("Failed to fetch getCommand");
      const code = await response.text();
      const module = { exports: {} };
      eval(code);
      getCommand = module.exports;
    } catch (err) {
      return res
        .status(500)
        .json({ error: "Failed to fetch getCommand: " + err.message });
    }

    // Create an isolated temporary directory for this specific request
    const reqId = crypto.randomUUID();
    const tempDir = path.join(os.tmpdir(), `compile_${reqId}`);
    fs.mkdirSync(tempDir, { recursive: true });

    let newFilename;
    if (lang.toLowerCase() === "java") {
      const codeContent = codeFile.buffer.toString("utf-8");
      const match = codeContent.match(
        /public\s+class\s+([A-Za-z_][A-Za-z0-9_]*)/,
      );
      if (!match) {
        fs.rmSync(tempDir, { recursive: true, force: true });
        return res
          .status(400)
          .json({ error: "Could not find a public class in your Java file." });
      }
      newFilename = match[1] + ".java";
    } else {
      const extMap = {
        c: ".c",
        cpp: ".cpp",
        python: ".py",
        java: ".java",
        javascript: ".js",
        typescript: ".ts",
        go: ".go",
        rust: ".rs",
        csharp: ".cs",
      };
      // Use the original filename from the buffer but replace the extension
      newFilename =
        (codeFile.originalname || "main").replace(/\.[^/.]+$/, "") +
        (extMap[lang.toLowerCase()] || "");
    }

    const newFilePath = path.join(tempDir, newFilename);
    fs.writeFileSync(newFilePath, codeFile.buffer); // Write code buffer to temp disk

    let inputFilePath = null;
    if (inputFile) {
      inputFilePath = path.join(tempDir, "input.txt");
      fs.writeFileSync(inputFilePath, inputFile.buffer); // Write input buffer to temp disk
    }

    let commandObj;
    try {
      commandObj = getCommand(lang, newFilename);
    } catch (err) {
      return res.status(400).json({ error: err.message });
    }

    const runCommand = (cmdString, hasInput, onExit) => {
      // ulimit -v 262144: Limits Virtual Memory to 256 MB per process
      // ulimit -t 5: Limits actual CPU processing time to 5 seconds
      const wrappedCmd = `ulimit -v 262144; ulimit -t 5; ${cmdString}`;

      // Spawn bash to execute the ulimit wrapper
      const child = spawn("bash", ["-c", wrappedCmd], {
        cwd: tempDir, // Forces the process to run inside the isolated temp directory
      });

      // Wall-clock timeout (backup to CPU timeout)
      const timeout = setTimeout(() => {
        child.kill("SIGKILL");
      }, 5000);

      child.on("close", () => clearTimeout(timeout));

      let stdout = "",
        stderr = "";
      child.stdout.on("data", (data) => (stdout += data.toString()));
      child.stderr.on("data", (data) => (stderr += data.toString()));

      child.on("error", (err) => onExit(err, null, null));
      child.on("close", (code) =>
        onExit(null, { code, stdout, stderr }, child),
      );

      if (hasInput && inputFilePath) {
        const inputStream = fs.createReadStream(inputFilePath);
        inputStream.pipe(child.stdin);
      } else {
        child.stdin.end();
      }
    };

    const cleanUpFiles = () => {
      // Recursively deletes the temp directory and everything inside it
      try {
        fs.rmSync(tempDir, { recursive: true, force: true });
      } catch (err) {
        console.error("Failed to clean temp dir:", err);
      }
    };

    if (commandObj.compile && commandObj.run) {
      runCommand(commandObj.compile, false, (compileErr, compileResult) => {
        if (compileErr || compileResult.code !== 0) {
          cleanUpFiles();
          return res.status(200).json({
            success: false,
            error:
              compileErr?.message ||
              compileResult.stderr ||
              `Compilation failed`,
          });
        }
        // Pass true if inputFile exists
        runCommand(commandObj.run, !!inputFile, (runErr, runResult) => {
          cleanUpFiles();
          if (runErr || runResult.code !== 0) {
            return res.status(200).json({
              success: false,
              error:
                runErr?.message ||
                runResult.stderr ||
                runResult.stdout ||
                `Execution failed`,
            });
          }
          res.status(200).json({ success: true, output: runResult.stdout });
        });
      });
    } else {
      runCommand(commandObj.run, !!inputFile, (err, result) => {
        cleanUpFiles();
        if (err || result.code !== 0) {
          return res.status(200).json({
            success: false,
            error: err?.message || result.stderr || `Execution failed`,
          });
        }
        res.status(200).json({ success: true, output: result.stdout });
      });
    }
  } catch (err) {
    // If anything unexpected fails, pass it to the global error handler
    next(err);
  }
});

const requireInstallApiKey = (req, res, next) => {
  const apiKey = req.headers["x-api-key"];
  // Compare against an environment variable
  if (!apiKey || apiKey !== process.env.INSTALL_API_KEY) {
    return res
      .status(403)
      .json({ error: "Forbidden: Invalid or missing API Key" });
  }
  next();
};

app.post("/install", requireInstallApiKey, async (req, res) => {
  try {
    const lang = req.body.lang;
    let dependencies = req.body.dependencies || [];

    if (!lang || !Array.isArray(dependencies) || dependencies.length === 0) {
      return res
        .status(400)
        .json({ error: "Missing language or dependencies" });
    }

    // Sanitize dependency names to prevent command injection
    dependencies = dependencies.map((dep) =>
      dep.replace(/[^a-zA-Z0-9\-_.@/]/g, ""),
    );

    let installCmd;

    switch (lang.toLowerCase()) {
      case "python":
        installCmd = `pip3 install ${dependencies.map((dep) => `'${dep}'`).join(" ")}`;
        break;

      case "javascript":
      case "typescript":
        installCmd = `npm install -g ${dependencies.map((dep) => `'${dep}'`).join(" ")}`;
        break;

      case "java":
        return res.status(400).json({
          error:
            "Global library installation not supported for Java. Use Maven or Gradle in your project.",
        });

      case "c":
      case "cpp":
        installCmd = `apt-get update && apt-get install -y ${dependencies.join(" ")}`;
        break;

      case "rust":
        installCmd = `cargo install ${dependencies.join(" ")}`;
        break;

      case "go":
        installCmd = `go get ${dependencies.join(" ")}`;
        break;

      case "csharp":
      case "c#":
        installCmd = `dotnet add package ${dependencies.join(" ")}`;
        break;

      default:
        return res.status(400).json({ error: "Unsupported language" });
    }

    exec(installCmd, { timeout: 180000 }, (error, stdout, stderr) => {
      if (error) {
        return res.status(500).json({
          success: false,
          error: stderr || error.message,
        });
      }

      res.status(200).json({
        success: true,
        output: stdout,
      });
    });
  } catch (err) {
    // If anything unexpected fails, pass it to the global error handler
    next(err);
  }
});

// Graceful shutdown handling
process.on("SIGTERM", async () => {
  console.log("Received SIGTERM. Shutting down gracefully...");
  await requestLogger.close();
  process.exit(0);
});

process.on("SIGINT", async () => {
  console.log("Received SIGINT. Shutting down gracefully...");
  await requestLogger.close();
  process.exit(0);
});

// ---- GLOBAL ERROR HANDLER ----
app.use((err, req, res, next) => {
  console.error("Unhandled error caught by Express:", err);
  res.status(500).json({ success: false, error: "Internal Server Error" });
});

// ---- PROCESS-LEVEL ERROR HANDLING ----
process.on('uncaughtException', (err) => {
    console.error('CRITICAL: Uncaught Exception:', err);
    // In an ideal world, you'd restart the server here. 
    // By keeping it running, we ensure the app doesn't crash, but you must monitor these logs.
});

process.on('unhandledRejection', (reason, promise) => {
    console.error('CRITICAL: Unhandled Promise Rejection at:', promise, 'reason:', reason);
});

app.listen(port, () => {
  console.log(`🚀 Compiler server running on port ${port}`);
  console.log(`📊 Simple request logging is active`);
});
