# Instagram Reels Distributor

> **A fully automated Instagram Reels distribution service powered by Playwright, GitHub Actions and the Freedom Project.**

This repository is a standalone module of the **Freedom Project**, responsible for discovering, downloading and distributing Instagram Reels directly to end users.

Instead of relying on Instagram APIs or unofficial endpoints, the project reproduces real browser behavior to automatically collect and deliver videos.

---

## 🚀 Part of Freedom Project

Instagram Reels Distributor is one component of the **Freedom Project**.

### Freedom Project

https://github.com/amyrmhdyfrhzady/FREEDOMPROJECT

---

## ✨ Features

- 🎬 Automatic Instagram Reels discovery
- 🌍 Multiple Instagram categories
- 📄 MHTML-based Reel extraction
- 🤖 Full browser automation with Playwright
- 🖱️ Real user behavior simulation
- ⬇️ Automatic Reel downloading
- 👥 Automatic delivery to every registered user
- 💾 Persistent duplicate detection
- 🚫 Never sends the same Reel twice
- ⚡ Compatible with external Cron services
- 🔄 Fault-tolerant delivery system
- 📦 Sends real video files (not download links)
- 🧩 Minimal and clean architecture

---

## ⚙️ Workflow

```text
External Scheduler
        │
        ▼
Open Instagram Categories
        │
        ▼
Download MHTML
        │
        ▼
Extract Reel URLs
        │
        ▼
Remove Duplicates
        │
        ▼
Skip Previously Sent Videos
        │
        ▼
Open Downloader Website
        │
        ▼
Fill Input Automatically
        │
        ▼
Click Download
        │
        ▼
Capture Downloaded File
        │
        ▼
Load Registered Users
        │
        ▼
Send Video To Every User
        │
        ▼
Store Video History
```

---

## 🏗️ Architecture

- Playwright
- GitHub Actions
- External Cron Scheduler
- MHTML Parser
- Persistent Database
- Bale Bot API

---

## 🔒 Duplicate Protection

Every successfully delivered Reel is permanently stored.

Future executions automatically ignore previously processed Reels, ensuring users only receive fresh content.

---

## 🛡️ Fault Tolerance

If sending a video to one user fails, the workflow continues sending it to all remaining users.

A single failed delivery will never stop the workflow.

---

## 📂 Categories

Categories are configured from a single configuration file.

Each category has its own collection limit.

---

# 📲 Usage

There is **no installation required**.

This project is a production service and is not intended to be installed locally.

To receive Instagram Reels, simply start the official Bale bot:

## 👉 @ReelsSenderbot

After starting the bot, every newly discovered Reel will automatically be downloaded and delivered directly to your chat as a video file.

**No configuration.**

**No commands.**

**No subscriptions.**

Just start the bot and enjoy.

---

## 🛠️ Tech Stack

- JavaScript
- Node.js
- Playwright
- GitHub Actions
- MHTML
- Bale Bot API

---

## 📄 License

This repository is a module of the **FREEDOMPROJECT** and follows the same licensing terms.
