const express = require('express');
const multer = require('multer');
const fs = require('fs');
const { exec } = require('child_process');
const path = require('path');
// const fetch = require('node-fetch');

const app = express();
const port = process.env.PORT || 3000;

const upload = multer({ dest: 'uploads/' });
app.use(express.json()); // Add this to parse JSON bodies

function getDefaultExtension(lang) {
    switch (lang) {
        case 'c': return '.c';
        case 'cpp': return '.cpp';
        case 'python': return '.py';
        case 'javascript': return '.js';
        case 'typescript': return '.ts';
        case 'java': return '.java';
        case 'go': return '.go';
        case 'rust': return '.rs';
        case 'csharp': return '.cs';
        default: return '';
    }
}


app.post('/compile', upload.single('code'), async (req, res) => {
    const lang = req.body.lang;
    if (!lang || !req.file) {
        return res.status(400).json({ error: 'Missing language or code file' });
    }

    // Fetch getCommand from Gist
    const gistUrl = 'https://gist.githubusercontent.com/er-abhijeet/8bc83b87e38d80af99acfe750f52ae52/raw/e202ffd67b95120106772844fbda4d1e43158fa5/getCommand.js';
    let getCommand;
    try {
        const response = await fetch(gistUrl);
        if (!response.ok) throw new Error('Failed to fetch getCommand');
        const code = await response.text();
        const module = { exports: {} };
        eval(code); // This will set module.exports
        getCommand = module.exports;
    } catch (err) {
        return res.status(500).json({ error: 'Failed to fetch getCommand: ' + err.message });
    }

    let command;
    let newFilePath
    try {
        // Get original extension
        const originalExt = path.extname(req.file.originalname) || getDefaultExtension(lang);
        const newFilename = req.file.filename + originalExt;
         newFilePath = path.join(__dirname, 'uploads', newFilename);

        // Rename file to include extension
        fs.renameSync(req.file.path, newFilePath);

        // Now generate the command
        command = getCommand(lang, newFilename);
        // command = getCommand(lang, req.file.filename);
        // console.log('Generated command:', command);
        // console.log('File path:', req.file.path);
        // console.log('File size:', req.file.size);
   
    } catch (err) {
        return res.status(400).json({ error: err.message });
    }
const cleanupPath = newFilePath; 
    exec(command, { timeout: 5000 }, (error, stdout, stderr) => {
        // Cleanup
        fs.unlinkSync(cleanupPath);

        if (error) {
            return res.status(200).json({
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


app.listen(port, '0.0.0.0',() => {
    console.log(`Compiler server running on port ${port}`);
});
