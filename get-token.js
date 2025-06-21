const fs = require("fs");
const readline = require("readline");
const { google } = require("googleapis");

// Load client secrets from a local file
const credentials = JSON.parse(fs.readFileSync("credentials/client_secret.json"));
const { client_id, client_secret, redirect_uris } =
  credentials.installed || credentials.web;

const oAuth2Client = new google.auth.OAuth2(
  client_id,
  client_secret,
  redirect_uris[0]
);

const SCOPES = ["https://www.googleapis.com/auth/spreadsheets"];

// Generate a URL for user to authenticate
const authUrl = oAuth2Client.generateAuthUrl({
  access_type: "offline",
  scope: SCOPES,
});

console.log("Authorize this app by visiting this URL:\n", authUrl);

const rl = readline.createInterface({
  input: process.stdin,
  output: process.stdout,
});

rl.question("\nEnter the code from that page here: ", (code) => {
  rl.close();
  oAuth2Client.getToken(code, (err, token) => {
    if (err) return console.error("Error retrieving access token", err);
    oAuth2Client.setCredentials(token);

    // Save the token to file
    if (!fs.existsSync("credentials")) {
      fs.mkdirSync("credentials");
    }
    fs.writeFileSync("credentials/token.json", JSON.stringify(token));
    console.log("\n✅ Token stored to credentials/token.json");
  });
});