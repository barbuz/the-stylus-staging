# The Stylus

A browser-based tool for gurus to edit result sheets for 3 Card Blind MTG matches from [3cardblind.com](www.3cardblind.com). This application runs entirely in your browser without requiring a server.


## 🎮 How to Use

### 1. **Authentication**
- Click "Sign in with Google" 
- Grant permissions for Google Sheets access
- Your session will be remembered between visits

**Note:** You need a Google account to use this app, both because you need to be logged in to edit sheets
and because the app stores its configuration on your Google appData. This means that you can change devices
and continue guruing!

### 2. **Set Guru Signature**
- Enter your guru username
- This filters the sheet to show only your matches
- Signature is saved locally for future sessions

### 3. **Load Pod Sheet**
- Paste the Google Sheets URL from 3cardblind.com
- The app will load and parse the pod data
- Only matches assigned to your guru signature will be displayed

### 4. **Fill the Goldfish Clocks**
- Before analysing, the app opens the Deck Notes screen one deck at a time
- The deck's cards are shown large, with its clock and notes on the right
  (under the cards on mobile)
- Every deck's goldfish clock must be filled before "Start guruing" unlocks
- Repeated consecutive decks are shown once; your edits apply to each of them
- Hover a clock to see who filled it

### 5. **Analyse Matches**
- View card images for both players
- Use Win/Tie/Loss buttons to score matches
- Navigate between matches with Previous/Next buttons
- Use the **Deck Notes** button in the controls to revisit the clocks and notes
  screen, then **Back to analysis** to return
- Changes are saved automatically to the Google Sheet

### 6. **Track Progress**
- See current match number and total matches
- View completion status
- Restart analysis if needed

### 7. **Reporting a Bug**
- Click the small **Log** button in the footer, or in the analysis screen's
  top-right controls while a pod is open
- This downloads `the-stylus-log-YYYYMMDD-HHMMSS.txt`, a plain-text diagnostic
  log with the app version, the current URL and recent activity
- Attach that file to your bug report; access tokens and email addresses are
  removed automatically, but the file may still contain match data

## 🌐 Browser Requirements

- **Modern Browser Support:**
  - ✅ Chrome 80+
  - ✅ Firefox 75+
  - ✅ Safari 13+
  - ✅ Edge 80+

- **Required Features:**
  - JavaScript enabled
  - ES6 module support
  - localStorage support
  - Internet connection for Google APIs and card images

## 🤝 Contributing

This is an open-source project. Contributions are welcome!

### Development Setup

1. **Clone the repository:**
   ```bash
   git clone https://github.com/barbuz/the-stylus.git
   cd the-stylus
   ```

2. **Set up local server:**
   ```bash
   python -m http.server 8000
   ```

### Version Management

The app version is managed in `sw.js` at the top of the file. When making changes that should trigger a service worker update:

1. Update the `APP_VERSION` constant in `sw.js`
2. This changes the service worker file, causing the browser to detect a new version
3. The version is fetched and parsed by `main.js` and displayed in the app footer
4. Service worker will activate on page reload with updated cache

### Production and preview versions

There are two live versions of the app, on the same GitHub Pages origin:

| Version | URL |
| --- | --- |
| Production | https://barbuz.github.io/the-stylus/ |
| Preview | https://barbuz.github.io/the-stylus-staging/ |

New work is tested in **Preview** first and promoted to Production once testers
are happy. Both versions share the same login, guru signature and recent pods,
so you can switch between them without signing in again.

The footer shows which version you are on and offers a **Switch** button. That
button also records your choice for this browser, so links you open afterwards
(the pod links posted to Discord) take you to the same version. The choice is
per browser and is not synced to your Google account; clearing site data resets
it to Production.