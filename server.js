// ✅ STARTING POINT
console.log("Starting backend...");

require("dotenv").config();
const express = require("express");
const cors = require("cors");
const fs = require("fs");
const { google } = require("googleapis");

const app = express();
app.use(cors());
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

const PORT = process.env.PORT || 8080;

// ✅ Check for required env variable
if (!process.env.GOOGLE_SHEET_ID) {
  console.error("❌ GOOGLE_SHEET_ID not found in .env file");
  process.exit(1);
}

// ✅ Load client credentials
const credentials = JSON.parse(
  fs.readFileSync("credentials/client_secret.json")
);

const { client_id, client_secret, redirect_uris } =
  credentials.installed || credentials.web;

const oAuth2Client = new google.auth.OAuth2(
  client_id,
  client_secret,
  redirect_uris[0]
);

// ✅ Load token
const TOKEN_PATH = "credentials/token.json";

function authorizeWithToken() {
  if (fs.existsSync(TOKEN_PATH)) {
    const token = JSON.parse(fs.readFileSync(TOKEN_PATH));
    oAuth2Client.setCredentials(token);
    return oAuth2Client;
  } else {
    console.log("❌ Token not found. Please run: node get-token.js");
    process.exit(1);
  }
}

// ✅ Fetch data from Google Sheet
async function getSheetData(auth) {
  const sheets = google.sheets({ version: "v4", auth });

  const res = await sheets.spreadsheets.values.get({
    spreadsheetId: process.env.GOOGLE_SHEET_ID,
    range: "Sheet1!A2:F",
  });

  return res.data.values || [];
}

// ✅ API Endpoint
app.get("/api/topics", async (req, res) => {
  try {
    const auth = authorizeWithToken();
    const data = await getSheetData(auth);
    res.json(data);
  } catch (err) {
    res.status(500).send("Failed to fetch topics");
  }
});

app.get("/", (req, res) => {
  res.send("✅ Backend is up!");
});

app.listen(PORT, () => {
  console.log(`✅ Server running at http://localhost:${PORT}`);
});