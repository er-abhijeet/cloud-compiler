const express = require('express');
const multer = require('multer');
const fs = require('fs');
const { exec } = require('child_process');
const path = require('path');

const app = express();
const port = process.env.PORT || 3000;

const upload = multer({ dest: 'uploads/' });

// Utility: detect command based on language
function getCommand(lang, filename) {
    const filepath = path.join(__dirname, 'uploads', filename);
    const outputPath = filepath + '.out';

    switch (lang) {
        case 'c':
            return `gcc ${filepath} -o ${outputPath} && ${outputPath}`;
        case 'cpp':
            return `g++ ${filepath} -o ${outputPath} && ${outputPath}`;
        case 'python':
            return `python3 ${filepath}`;
        case 'java':
            const base = path.basename(filename, '.java');
            return `javac ${filepath} && java -cp uploads ${base}`;
        default:
            throw new Error('Unsupported language');
    }
}

app.post('/compile', upload.single('code'), async (req, res) => {
    const lang = req.body.lang;
    if (!lang || !req.file) {
        return res.status(400).json({ error: 'Missing language or code file' });
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
