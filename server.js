const express = require('express');
const multer = require('multer');
const fs = require('fs');
const { exec } = require('child_process');
const path = require('path');
const fetch = require('node-fetch');

const app = express();
const port = process.env.PORT || 3000;

const upload = multer({ dest: 'uploads/' });

app.post('/compile', upload.single('code'), async (req, res) => {
    const lang = req.body.lang;
    if (!lang || !req.file) {
        return res.status(400).json({ error: 'Missing language or code file' });
    }

    // Fetch getCommand from Gist
    const gistUrl = 'https://gist.githubusercontent.com/er-abhijeet/8bc83b87e38d80af99acfe750f52ae52/raw/getCommand.js';
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
    try {
        command = getCommand(lang, req.file.filename);
    } catch (err) {
        return res.status(400).json({ error: err.message });
    }

    exec(command, { timeout: 5000 }, (error, stdout, stderr) => {
        // Cleanup
        fs.unlinkSync(req.file.path);

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

app.listen(port, () => {
    console.log(`Compiler server running on port ${port}`);
});
