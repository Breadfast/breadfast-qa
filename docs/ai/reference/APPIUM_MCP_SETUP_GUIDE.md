# Appium MCP Setup Guide - Step by Step

## 📋 Overview

This guide will help you set up **Appium MCP (Model Context Protocol)** to enable natural language test automation in your framework. Appium MCP allows you to write tests using plain English instructions instead of traditional code.

---

## 🎯 What is Appium MCP?

**Appium MCP** is a Model Context Protocol server that bridges natural language commands with Appium automation. It allows you to:
- Write tests in natural language (English)
- Automatically translate instructions to Appium commands
- Reduce code complexity and maintenance
- Speed up test creation

---

## 📦 Prerequisites

Before starting, ensure you have:

1. **Node.js** (v18 or higher) - [Download here](https://nodejs.org/)
2. **npm** (comes with Node.js)
3. **Appium** already installed (you have this in your framework)
4. **BrowserStack credentials** configured
5. **Java 24** (already in your framework)

---

## 🔧 Step 1: Install Node.js and npm

### Check if Node.js is installed:
```bash
node --version
npm --version
```

If not installed:
- **macOS**: `brew install node`
- **Windows**: Download from [nodejs.org](https://nodejs.org/)
- **Linux**: `sudo apt-get install nodejs npm`

---

## 🔧 Step 2: Install Appium MCP Server

### Option A: Install via npm (Recommended)

```bash
# Navigate to your project root
cd /Users/rukn/Desktop/QA_Automation_Framework

# Install Appium MCP server globally
npm install -g @appium/mcp-server

# Or install locally in your project
npm init -y
npm install @appium/mcp-server
```

### Option B: Install via MCP Registry

```bash
# Install MCP SDK first
npm install -g @modelcontextprotocol/cli

# Then install Appium MCP
mcp install @appium/mcp-server
```

---

## 🔧 Step 3: Verify Installation

```bash
# Check if Appium MCP is installed
npm list -g @appium/mcp-server

# Or check locally
npm list @appium/mcp-server
```

---

## 🔧 Step 4: Configure MCP in Your IDE (Cursor/VS Code)

### For Cursor IDE:

1. Open Cursor Settings (Cmd+, on Mac, Ctrl+, on Windows)
2. Search for "MCP" or "Model Context Protocol"
3. Add MCP server configuration:

```json
{
  "mcp": {
    "servers": {
      "appium": {
        "command": "npx",
        "args": ["@appium/mcp-server"],
        "env": {
          "APPIUM_HOME": "/path/to/appium"
        }
      }
    }
  }
}
```

### Alternative: Create `.cursor/mcp.json`:

```json
{
  "mcpServers": {
    "appium": {
      "command": "npx",
      "args": ["@appium/mcp-server"],
      "env": {
        "APPIUM_HOME": "/usr/local/lib/node_modules/appium"
      }
    }
  }
}
```

---

## 🔧 Step 5: Configure BrowserStack Connection

Appium MCP needs to know how to connect to BrowserStack. Create a configuration file:

### Create `appium-mcp-config.json`:

```json
{
  "browserstack": {
    "user": "YOUR_BROWSERSTACK_USERNAME",
    "key": "YOUR_BROWSERSTACK_ACCESS_KEY",
    "app": "bs://YOUR_APP_ID",
    "device": "Samsung Galaxy S21",
    "osVersion": "11.0",
    "platformName": "Android"
  },
  "appium": {
    "serverUrl": "http://localhost:4723",
    "capabilities": {
      "platformName": "Android",
      "automationName": "UiAutomator2"
    }
  }
}
```

**⚠️ Important**: Replace with your actual BrowserStack credentials from `browserStackConfigs.properties`

---

## 🔧 Step 6: Test the Connection

### Test Appium MCP Server:

```bash
# Start MCP server manually to test
npx @appium/mcp-server

# You should see:
# "Appium MCP Server started on port 3000"
```

### Test with a simple command:

In Cursor, you can now use natural language like:
- "Launch the app on BrowserStack"
- "Tap on the search button"
- "Enter text 'Nuts' in the search field"

---

## 🔧 Step 7: Integration with Your Framework

We'll create a helper class that bridges Appium MCP with your existing Java framework. This allows you to:
- Use natural language in your tests
- Still leverage your existing BaseTest infrastructure
- Maintain compatibility with TestNG and Allure reporting

---

## ✅ Verification Checklist

Before proceeding to the POC test, verify:

- [ ] Node.js is installed (`node --version`)
- [ ] npm is installed (`npm --version`)
- [ ] Appium MCP server is installed (`npm list @appium/mcp-server`)
- [ ] MCP is configured in Cursor IDE
- [ ] BrowserStack credentials are configured
- [ ] App is uploaded to BrowserStack and you have the app ID

---

## 🐛 Troubleshooting

### Issue: "Command not found: npx"
**Solution**: Update Node.js to latest version or use full path: `/usr/local/bin/npx`

### Issue: "Cannot connect to Appium server"
**Solution**: 
- Ensure Appium is running: `appium --version`
- Check if port 4723 is available
- For BrowserStack, you don't need local Appium server

### Issue: "MCP server not recognized in Cursor"
**Solution**:
- Restart Cursor IDE
- Check `.cursor/mcp.json` syntax
- Verify MCP extension is enabled

### Issue: "BrowserStack authentication failed"
**Solution**:
- Verify credentials in `browserStackConfigs.properties`
- Check if app ID is correct (format: `bs://...`)
- Ensure BrowserStack account is active

---

## 📚 Next Steps

Once setup is complete, proceed to:
1. Review the `AppiumMCPHelper.java` integration class
2. Review the POC test `SearchAndAddToCartMCPTest.java`
3. Run the POC test and observe natural language automation

---

## 🔗 Useful Resources

- [Appium MCP Documentation](https://github.com/appium/appium-mcp-server)
- [MCP Protocol Specification](https://modelcontextprotocol.io/)
- [BrowserStack Appium Guide](https://www.browserstack.com/docs/app-automate/appium)

---

**Last Updated**: 2024
**Maintained By**: QA Automation Team


