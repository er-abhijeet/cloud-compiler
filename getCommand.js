const path = require('path');

module.exports = function getCommand(lang, filename) {
    function getDefaultExtension(lang) {
        switch (lang) {
            case 'c': return '.c';
            case 'cpp': return '.cpp';
            case 'python': return '.py';
            case 'java': return '.java';
            case 'javascript': return '.js';
            case 'typescript': return '.ts';
            case 'go': return '.go';
            case 'rust': return '.rs';
            case 'csharp': return '.cs';
            default: return '';
        }
    }

    const ext = path.extname(filename);
    const adjustedFilename = ext ? filename : filename + getDefaultExtension(lang);
    
    // The process is already running inside the temp directory (via cwd).
    // We only need the raw filename, not an absolute path.
    const filepath = adjustedFilename;
    
    // Prefix with ./ to explicitly tell Linux to execute from the current directory
    const outputPath = `./${filepath}.out`;

    switch (lang) {
        case 'c':
            return {
                compile: `gcc ${filepath} -o ${filepath}.out`,
                run: `${outputPath}`
            };
        case 'cpp':
            return {
                compile: `g++ ${filepath} -o ${filepath}.out`,
                run: `${outputPath}`
            };
        case 'rust':
            return {
                compile: `rustc ${filepath} -o ${filepath}.out`,
                run: `${outputPath}`
            };
        case 'java': {
            const base = path.basename(adjustedFilename, '.java');
            return {
                compile: `javac ${filepath}`,
                // Classpath (-cp) must be the current directory (.)
                run: `java -cp . ${base}` 
            };
        }
        case 'typescript':
            return {
                compile: `tsc ${filepath}`,
                run: `node ${filepath.replace(/\.ts$/, '.js')}`
            };
        case 'python':
            return { run: `python3 ${filepath}` };
        case 'javascript':
            return { run: `node ${filepath}` };
        case 'go':
            return { run: `go run ${filepath}` };
        case 'csharp':
            return { run: `dotnet run --project ${filepath}` };
        default:
            throw new Error('Unsupported language');
    }
};