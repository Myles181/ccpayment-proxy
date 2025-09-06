# CCPayment Proxy Server

A simple proxy server to provide a fixed IP address for CCPayment API calls from Supabase Edge Functions.

## What this does

- Receives requests from your Supabase Edge Functions
- Forwards them to CCPayment API with a **fixed IP address**
- Returns CCPayment's responses back to your functions

## Usage

### Local Development

```bash
npm install
npm start
```

### Testing

```bash
# Health check
curl http://localhost:3000/health

# Test proxy (replace with your actual CCPayment credentials)
curl -X POST http://localhost:3000/ccpayment/v2/getCoinList \
  -H "Content-Type: application/json" \
  -H "Appid: YOUR_APP_ID" \
  -H "Sign: YOUR_SIGNATURE" \
  -H "Timestamp: YOUR_TIMESTAMP"
```

## Deployment on Render

1. Push this code to GitHub
2. Connect to Render
3. Deploy as Web Service
4. Get your fixed IP from Render
5. Whitelist the IP in CCPayment
6. Update your Supabase functions to use: `https://your-app.onrender.com/ccpayment/`

## Environment Variables

No environment variables needed - this is a simple proxy.

## Endpoints

- `GET /` - Server status
- `GET /health` - Health check
- `POST /ccpayment/*` - Proxy to CCPayment API

## Example

Your Supabase function calls:

```
https://your-proxy.onrender.com/ccpayment/v2/getCoinList
```

Gets forwarded to:

```
https://ccpayment.com/ccpayment/v2/getCoinList
```
