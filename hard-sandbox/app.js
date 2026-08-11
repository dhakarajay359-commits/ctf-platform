const express = require('express');
const cookieParser = require('cookie-parser');
const serialize = require('node-serialize');
const app = express();

app.use(cookieParser());

app.get('/', (req, res) => {
    if (req.cookies.profile) {
        try {
            // VULNERABILITY: Insecure Deserialization
            // The node-serialize library executes Immediately Invoked Function Expressions (IIFE)
            // if they are appended with '()' during deserialization.
            const str = Buffer.from(req.cookies.profile, 'base64').toString('ascii');
            const obj = serialize.unserialize(str);
            
            if (obj.username) {
                res.send(`Welcome back, Architect ${obj.username}!`);
            } else {
                res.send("Profile corrupted.");
            }
        } catch (e) {
            res.send("Error processing profile.");
        }
    } else {
        // Send a default serialized profile
        const defaultProfile = { username: "Guest" };
        const serialized = serialize.serialize(defaultProfile);
        const b64 = Buffer.from(serialized).toString('base64');
        
        res.cookie('profile', b64, {
            maxAge: 900000,
            httpOnly: false // Allow players to see and manipulate it easily
        });
        res.send("Welcome! I have assigned you a default profile cookie. Can you break the serialization engine?");
    }
});

app.listen(8081, () => {
    console.log('Hard Sandbox running on port 8081');
});
