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

const PORT = 8080;

// ✅ Check for required env variable
if (!process.env.GOOGLE_SHEET_ID) {
  console.error("❌ GOOGLE_SHEET_ID not found in .env file");
  process.exit(1);
}

// ✅ Load client credentials
const credentials = JSON.parse(
  fs.readFileSync("credentials/client_secret.json")
);

// ✅ Destructure credentials
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

  console.log("🟡 Sending request to Google Sheets API...");

  try {
    const res = await sheets.spreadsheets.values.get({
      spreadsheetId: process.env.GOOGLE_SHEET_ID,
      range: "Sheet1!A2:F",
    });

    console.log("🟢 Received response from Google Sheets");
    return res.data.values || [];

  } catch (err) {
    console.error("🔴 Google Sheets API error:", err);
    throw err;
  }
}
// ✅ API Endpoint
app.get("/api/topics", async (req, res) => {
  console.log("📥 Incoming request to /api/topics");

  try {
    const auth = authorizeWithToken();
    console.log("✅ Authorized with Google");

    const data = await getSheetData(auth);
    console.log("📤 Sending data:", data);

    res.json(data);
  } catch (err) {
    console.error("❌ Error in /api/topics:", err);
    res.status(500).send("Failed to fetch topics");
  }
});
// 🔄 Update Status Route (with smart rescheduling)
app.post("/api/update-status", async (req, res) => {
  const { rowIndex, newStatus } = req.body;

  try {
    const auth = authorizeWithToken();
    const sheets = google.sheets({ version: "v4", auth });

    // Get existing data to calculate revision count
    const allData = await getSheetData(auth);
    const row = allData[rowIndex];
    const lastRevisedStr = row[3]; // D column
    let revisionCount = 0;

    if (lastRevisedStr) {
      revisionCount = row[8] ? parseInt(row[8]) : 1;
    }

    const today = new Date();
    const todayStr = today.toISOString().split("T")[0];

    let nextDue = "";

    if (newStatus === "Revised") {
      // Calculate new revision interval
      const gaps = [1, 3, 7, 15, 30];
      const nextGap = gaps[Math.min(revisionCount, gaps.length - 1)];

      const nextDate = new Date(today);
      nextDate.setDate(today.getDate() + nextGap);
      nextDue = nextDate.toISOString().split("T")[0];
    }

    // Update: C (Status), D (Last Revised), G (Next Due)
    await sheets.spreadsheets.values.batchUpdate({
      spreadsheetId: process.env.GOOGLE_SHEET_ID,
      requestBody: {
        valueInputOption: "USER_ENTERED",
        data: [
          {
            range: `Sheet1!C${rowIndex + 2}`,
            values: [[newStatus]],
          },
          {
            range: `Sheet1!D${rowIndex + 2}`,
            values: [[newStatus === "Revised" ? todayStr : ""]],
          },
          {
            range: `Sheet1!G${rowIndex + 2}`,
            values: [[nextDue]],
          },
        ],
      },
    });

    console.log(`✅ Updated row ${rowIndex + 2}: status, last revised, next due`);
    res.json({ success: true });

  } catch (error) {
    console.error("❌ Error updating revision info:", error);
    res.status(500).json({ success: false });
  }
});
// ✅ Get due revisions for today
app.get("/api/due-today", async (req, res) => {
  try {
    const auth = authorizeWithToken();
    const data = await getSheetData(auth);

    const today = new Date();
    const todayStr = today.toISOString().split("T")[0];
    const dueIntervals = [1, 3, 7, 15, 30];

    console.log("📅 Today's date is:", todayStr);

    const dueToday = data.filter((row) => {
      const dateStudiedStr = row[5]; // Column F: "Date Studied"

      if (!dateStudiedStr || !/^\d{4}-\d{2}-\d{2}$/.test(dateStudiedStr)) {
        console.log(`⚠️ Skipping invalid date format: "${dateStudiedStr}"`);
        return false;
      }

      const [year, month, day] = dateStudiedStr.split("-").map(Number);
      const dateStudied = new Date(year, month - 1, day);

      const diffDays = Math.floor((today - dateStudied) / (1000 * 60 * 60 * 24));
      const isDue = dueIntervals.includes(diffDays);

      console.log(`➡️ ${row[0]} – studied on ${dateStudiedStr}, ${diffDays} day(s) ago → Due: ${isDue}`);
      return isDue;
    });

    res.json(dueToday);
  } catch (err) {
    console.error("❌ Error in /api/due-today:", err);
    res.status(500).json({ success: false });
  }
});
// ✅ Get overdue topics
app.get("/api/overdue", async (req, res) => {
  try {
    const auth = authorizeWithToken();
    const data = await getSheetData(auth);

    const today = new Date();
    const dueIntervals = [1, 3, 7, 15, 30];

    const overdue = data.filter((row, index) => {
      const status = row[2]; // Column C: Status
      const dateStudiedStr = row[5]; // Column F: Date Studied

      if (status !== "Not Revised") return false;
      if (!dateStudiedStr || !/^\d{4}-\d{2}-\d{2}$/.test(dateStudiedStr)) return false;

      const [y, m, d] = dateStudiedStr.split("-").map(Number);
      const dateStudied = new Date(y, m - 1, d);
      const diff = Math.floor((today - dateStudied) / (1000 * 60 * 60 * 24));

      // It’s overdue if it has missed any revision milestone
      return dueIntervals.some(interval => diff > interval);
    });

    res.json(overdue);
  } catch (err) {
    console.error("❌ Error in /api/overdue:", err);
    res.status(500).json({ success: false });
  }
});
// ✅ Start Server
app.get("/", (req, res) => {
  res.send("👋 Hello, server is working!");
});
// ✅ New Route to Add a Topic
app.post("/api/add-topic", async (req, res) => {
  const { subject, topic, notes, dateStudied } = req.body;

  const newRow = [subject, topic, "Not Revised", "", notes, dateStudied];

  try {
    const auth = authorizeWithToken();
    const sheets = google.sheets({ version: "v4", auth });

    await sheets.spreadsheets.values.append({
      spreadsheetId: process.env.GOOGLE_SHEET_ID,
      range: "Sheet1!A2:F",
      valueInputOption: "USER_ENTERED",
      insertDataOption: "INSERT_ROWS",
      requestBody: {
        values: [newRow],
      },
    });

    console.log("✅ New topic added:", newRow);
    res.json({ success: true });
  } catch (err) {
    console.error("❌ Failed to add topic:", err);
    res.status(500).json({ success: false, error: "Error adding topic" });
  }
});
app.listen(PORT, '127.0.0.1', () => {
  console.log(`✅ Server is running on http://127.0.0.1:${PORT}`);
});