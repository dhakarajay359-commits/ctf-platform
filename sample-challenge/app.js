const express = require('express');
const app = express();

// A simple vulnerable endpoint (Directory Traversal)
app.get('/download', (req, res) => {
    const file = req.query.file;
    
    if (!file) {
        return res.send('Welcome to the file server! Please provide a file parameter. Example: /download?file=public.txt');
    }
    
    // VULNERABILITY: No security checks! We blindly read whatever file the user asks for.
    res.sendFile(__dirname + '/' + file);
});

app.listen(8080, () => {
    console.log('Sandbox Challenge running on port 8080');
});
