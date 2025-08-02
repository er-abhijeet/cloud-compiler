const express = require('express');
const multer = require('multer');
const fs = require('fs');
const { exec } = require('child_process');
const { spawn } = require('child_process');
const path = require('path');
// const fetch = require('node-fetch');

const app = express();
const port = process.env.PORT || 3000;

const upload = multer({ dest: 'uploads/' }).fields([
    { name: 'code', maxCount: 1 },
    { name: 'input', maxCount: 1 }
]);
app.use(express.json()); // Add this to parse JSON bodie


app.post('/compile', upload, async (req, res) => {
    const lang = req.body.lang;
    const codeFile = req.files?.code?.[0];
    const inputFile = req.files?.input?.[0];

    if (!lang || !codeFile) {
        return res.status(400).json({ error: 'Missing language or code file' });
    }

    // Load getCommand from Gist
    const gistUrl = 'https://gist.githubusercontent.com/er-abhijeet/6d9caf2ecbc4976f750f07d973d36e20/raw/ba2167a3e345a9bb8f2a58795382ccda23641e2a/getCommand1.js';
    let getCommand;
    try {
        const response = await fetch(gistUrl);
        if (!response.ok) throw new Error('Failed to fetch getCommand');
        const code = await response.text();
        const module = { exports: {} };
        eval(code);
        getCommand = module.exports;
    } catch (err) {
        return res.status(500).json({ error: 'Failed to fetch getCommand: ' + err.message });
    }

    // Rename file based on language rules
    let newFilename, newFilePath;
    if (lang.toLowerCase() === 'java') {
        const codeContent = fs.readFileSync(codeFile.path, 'utf-8');
        const match = codeContent.match(/public\s+class\s+([A-Za-z_][A-Za-z0-9_]*)/);
        if (!match) {
            return res.status(400).json({ error: 'Could not find a public class in your Java file. Please define one.' });
        }
        const className = match[1];
        newFilename = className + '.java';
        newFilePath = path.join(__dirname, 'uploads', newFilename);
        fs.renameSync(codeFile.path, newFilePath);
    } else {
        const extMap = {
            c: '.c', cpp: '.cpp', python: '.py', java: '.java',
            javascript: '.js', typescript: '.ts', go: '.go',
            rust: '.rs', csharp: '.cs'
        };
        const extension = extMap[lang.toLowerCase()] || '';
        newFilename = codeFile.filename + extension;
        newFilePath = path.join(__dirname, 'uploads', newFilename);
        fs.renameSync(codeFile.path, newFilePath);
    }

    let commandObj;
    try {
        commandObj = getCommand(lang, newFilename);
    } catch (err) {
        return res.status(400).json({ error: err.message });
    }

    const runCommand = (cmdString, inputStream, onExit) => {
        const [execCmd, ...args] = cmdString.split(' ');
        const child = spawn(execCmd, args);

        let stdout = '', stderr = '';
        child.stdout.on('data', data => stdout += data.toString());
        child.stderr.on('data', data => stderr += data.toString());

        child.on('error', err => onExit(err, null, null));
        child.on('close', code => onExit(null, { code, stdout, stderr }, child));

        if (inputStream) {
            inputStream.pipe(child.stdin);
        } else {
            child.stdin.end();
        }
    };

    const cleanUpFiles = () => {
        fs.unlink(newFilePath, () => {});
        if (inputFile) fs.unlink(inputFile.path, () => {});
        if (commandObj.run && commandObj.compile) {
            fs.unlink(newFilePath + '.out', () => {});
        }
    };

    if (commandObj.compile && commandObj.run) {
        runCommand(commandObj.compile, null, (compileErr, compileResult) => {
            if (compileErr || compileResult.code !== 0) {
                cleanUpFiles();
                return res.status(200).json({
                    success: false,
                    error: compileErr?.message || compileResult.stderr || `Compilation failed`
                });
            }

            const inputStream = inputFile ? fs.createReadStream(inputFile.path) : null;
            runCommand(commandObj.run, inputStream, (runErr, runResult) => {
                cleanUpFiles();
                if (runErr || runResult.code !== 0) {
                    return res.status(200).json({
                        success: false,
                        error: runErr?.message || runResult.stderr || runResult.stdout || `Execution failed`
                    });
                }

                res.status(200).json({ success: true, output: runResult.stdout });
            });
        });
    } else {
        const inputStream = inputFile ? fs.createReadStream(inputFile.path) : null;
        runCommand(commandObj.run, inputStream, (err, result) => {
            cleanUpFiles();
            if (err || result.code !== 0) {
                return res.status(200).json({
                    success: false,
                    error: err?.message || result.stderr || `Execution failed`
                });
            }

            res.status(200).json({ success: true, output: result.stdout });
        });
    }
});



app.post('/install', async (req, res) => {
    const lang = req.body.lang;
    let dependencies = req.body.dependencies || [];

    if (!lang || !Array.isArray(dependencies) || dependencies.length === 0) {
        return res.status(400).json({ error: 'Missing language or dependencies' });
    }

    // Sanitize dependency names to prevent command injection
    dependencies = dependencies.map(dep =>
        dep.replace(/[^a-zA-Z0-9\-_.@/]/g, '')
    );

    let installCmd;

    switch (lang.toLowerCase()) {
        case 'python':
            installCmd = `pip3 install ${dependencies.map(dep => `'${dep}'`).join(' ')}`;
            break;

        case 'javascript':
        case 'typescript':
            installCmd = `npm install -g ${dependencies.map(dep => `'${dep}'`).join(' ')}`;
            break;

        case 'java':
            return res.status(400).json({
                error: 'Global library installation not supported for Java. Use Maven or Gradle in your project.'
            });

        case 'c':
        case 'cpp':
            installCmd = `apt-get update && apt-get install -y ${dependencies.join(' ')}`;
            break;

        case 'rust':
            installCmd = `cargo install ${dependencies.join(' ')}`;
            break;

        case 'go':
            installCmd = `go get ${dependencies.join(' ')}`;
            break;

        case 'csharp':
        case 'c#':
            installCmd = `dotnet add package ${dependencies.join(' ')}`;
            break;

        default:
            return res.status(400).json({ error: 'Unsupported language' });
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
});


app.listen(port, () => {
    console.log(`Compiler server running on port ${port}`);
});
