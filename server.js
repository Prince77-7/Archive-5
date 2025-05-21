// Proxy server for Shelby County Parcel Viewer
const express = require('express');
const axios = require('axios');
const cors = require('cors');
const bodyParser = require('body-parser');
const path = require('path');
const { exec } = require('child_process'); // Added for curl
const https = require('https'); // Added for custom agent
const constants = require('constants'); // Added for SSL options

const app = express();
const PORT = process.env.PORT || 901;

// Enable CORS for all routes (simple configuration)
app.use(cors());

// Parse JSON request bodies
app.use(bodyParser.json());

// Serve static files from the current directory
app.use(express.static(path.join(__dirname)));

// Proxy endpoint for Register of Deeds API
app.post('/api/register-proxy', async (req, res) => {
  try {
    // Extract parcelId from request
    const parcelId = req.body.parcelid;
    
    if (!parcelId) {
      return res.status(400).json({ error: 'Parcel ID is required' });
    }
    
    console.log(`Proxying request for parcel ID: ${parcelId}`);
    
    // Make the actual request to the Register of Deeds API
    const response = await axios.post('https://gis.register.shelby.tn.us/completedetails', 
      { parcelid: parcelId },
      { 
        headers: {
          'Content-Type': 'application/json',
          'Accept': 'application/json'
        }
      }
    );
    
    // Return the data to the client
    res.json(response.data);
  } catch (error) {
    console.error('Proxy request failed:', error.message);
    res.status(500).json({ 
      error: 'Proxy request failed', 
      message: error.message,
      details: error.response ? error.response.data : null
    });
  }
});

// NEW: Proxy endpoint for Shelby County Trustee Tax Info
app.get('/api/trustee-tax-proxy', async (req, res) => {
    const parcelIdQuery = req.query.parcelId;
    if (!parcelIdQuery) {
        return res.status(400).send('ParcelID query parameter is required');
    }

    const trusteeUrl = `https://apps.shelbycountytrustee.com/TaxQuery/Inquiry.aspx?ParcelID=${encodeURIComponent(parcelIdQuery)}`;
    
    // Create a custom HTTPS agent to allow unsafe legacy renegotiation
    const customAgent = new https.Agent({
        secureOptions: constants.SSL_OP_ALLOW_UNSAFE_LEGACY_RENEGOTIATION | constants.SSL_OP_LEGACY_SERVER_CONNECT
    });

    try {
        console.log(`TRUSTEE PROXY (server.js via axios with custom agent): Requesting data for Parcel ID '${parcelIdQuery}' from ${trusteeUrl}`);
        
        const response = await axios.get(trusteeUrl, {
            httpsAgent: customAgent,
            headers: {
                'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36',
                'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,image/apng,*/*;q=0.8,application/signed-exchange;v=b3;q=0.9',
                'Accept-Language': 'en-US,en;q=0.9',
                'Connection': 'keep-alive',
                // 'Referer': 'https://apps.shelbycountytrustee.com/' // Optional, can add if needed
            },
            timeout: 20000 // 20 second timeout
        });
        res.send(response.data);
    } catch (error) {
        console.error(`TRUSTEE PROXY AXIOS ERROR (server.js) for Parcel ID '${parcelIdQuery}':`);
        if (error.response) {
            console.error('Error Status:', error.response.status);
            console.error('Error Headers:', error.response.headers);
            // console.error('Error Data:', error.response.data); // Could be a lot of HTML
            res.status(error.response.status).send(`Error fetching data from Trustee website (Status: ${error.response.status}). Check server logs for details.`);
        } else if (error.request) {
            // This part now more likely covers SSL errors or network issues if OpenSSL still blocks it
            console.error('Error Request: No response or connection error.', error.message); // error.message will contain the SSL error like 'unsafe legacy renegotiation disabled' if it still occurs at OpenSSL level
            if (error.message && error.message.includes('unsafe legacy renegotiation disabled')) {
                res.status(502).send('SSL Error: Unsafe legacy renegotiation disabled. Connection to Trustee failed.');
            } else if (error.code === 'ECONNREFUSED'){
                res.status(503).send('Connection Refused by Trustee website.');
            } else if (error.code === 'ETIMEDOUT') {
                 res.status(504).send('Request to Trustee website timed out.');
            } else {
                res.status(503).send(`Service Unavailable: No response or connection error with Trustee website. (${error.message})`);
            }
        } else {
            console.error('Generic Error (server.js axios trustee):', error.message);
            res.status(500).send('Server error while attempting to proxy request to Trustee website (axios). ');
        }
    }
});

// NEW: Proxy endpoint for Shelby County Assessor Property Details
app.get('/api/assessor-proxy', async (req, res) => {
    const parcelIdQuery = req.query.parcelId;
    if (!parcelIdQuery) {
        return res.status(400).send('ParcelID query parameter is required for Assessor proxy');
    }

    // The parcelId for the assessor is typically space-separated, e.g., "G0219A D00101"
    // Ensure it's properly encoded for the URL
    const assessorUrl = `https://www.assessormelvinburgess.com/propertyDetails?IR=true&parcelid=${encodeURIComponent(parcelIdQuery)}`;
    const userAgent = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36';
    const command = `curl -s -L -A "${userAgent}" "${assessorUrl}" --compressed`;

    try {
        console.log(`ASSESSOR PROXY (server.js via curl): Requesting data for Parcel ID '${parcelIdQuery}' from ${assessorUrl}`);
        
        exec(command, { timeout: 20000, maxBuffer: 1024 * 1024 * 5 }, (error, stdout, stderr) => {
            if (error) {
                console.error(`ASSESSOR PROXY EXEC ERROR (server.js) for Parcel ID '${parcelIdQuery}':`, error.message);
                console.error(`Curl stderr for Assessor: ${stderr}`);
                if (error.killed) {
                    res.status(504).send('Request to Assessor website timed out (curl proxy).');
                } else if (stderr.includes('Could not resolve host') || stderr.includes('SSL')) {
                    res.status(502).send('Bad Gateway: Error connecting to Assessor website (curl proxy - network/SSL issue). Check server logs.');
                } else {
                    res.status(500).send('Server error while attempting to proxy request to Assessor website (curl proxy). Check server logs.');
                }
                return;
            }
            if (stdout) {
                res.send(stdout);
            } else {
                console.warn(`ASSESSOR PROXY (server.js via curl): No stdout received for Parcel ID '${parcelIdQuery}', but no error. Stderr: ${stderr}`);
                res.status(204).send(); // No content, but request was successful
            }
        });
    } catch (error) {
        console.error(`ASSESSOR PROXY GENERIC CATCH ERROR (server.js) for Parcel ID '${parcelIdQuery}':`, error.message);
        res.status(500).send('Server error while attempting to proxy request to Assessor website (server.js general).');
    }
});

// NEW: Proxy endpoint for City of Memphis Tax Details
app.get('/api/memphis-tax-proxy', async (req, res) => {
    const parcelIdQuery = req.query.parcelId;
    if (!parcelIdQuery) {
        return res.status(400).send('ParcelID query parameter is required for Memphis tax proxy');
    }

    // Parcel ID for Memphis ePayments is typically space-separated, e.g., "095101 F00034"
    const memphisTaxUrl = `https://epayments.memphistn.gov/Property/Detail.aspx?ParcelNo=${encodeURIComponent(parcelIdQuery)}`;
    const userAgent = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36';
    
    // Using curl, similar to other proxies, including --insecure due to potential SSL strictness on older systems/CDNs
    const command = `curl -v --fail -s -L --insecure -A "${userAgent}" "${memphisTaxUrl}" --compressed`;

    try {
        console.log(`MEMPHIS TAX PROXY (server.js via curl): Requesting data for Parcel ID '${parcelIdQuery}' from ${memphisTaxUrl}`);
        
        exec(command, { timeout: 25000, maxBuffer: 1024 * 1024 * 5 }, (error, stdout, stderr) => {
            if (error) {
                console.error(`MEMPHIS TAX PROXY EXEC ERROR (server.js) for Parcel ID '${parcelIdQuery}':`, error.message);
                console.error(`Curl stderr for Memphis Tax: ${stderr}`);
                if (error.killed) {
                    res.status(504).send('Request to Memphis ePayments website timed out (curl proxy).');
                } else if (stderr.includes('Could not resolve host') || stderr.includes('SSL routines::unsafe legacy renegotiation disabled') || stderr.includes('SSL')) {
                    res.status(502).send('Bad Gateway: Error connecting to Memphis ePayments website (curl proxy - network/SSL issue). Check server logs.');
                } else {
                    res.status(500).send('Server error while attempting to proxy request to Memphis ePayments website (curl proxy). Check server logs.');
                }
                return;
            }
            if (stdout) {
                res.send(stdout);
            } else {
                console.warn(`MEMPHIS TAX PROXY (server.js via curl): No stdout received for Parcel ID '${parcelIdQuery}', but no error. Stderr: ${stderr}`);
                res.status(204).send(); // No content, but request was successful
            }
        });
    } catch (error) {
        console.error(`MEMPHIS TAX PROXY GENERIC CATCH ERROR (server.js) for Parcel ID '${parcelIdQuery}':`, error.message);
        res.status(500).send('Server error while attempting to proxy request to Memphis ePayments website (server.js general).');
    }
});

// Start the server
app.listen(PORT, () => {
  console.log(`Proxy server running at http://localhost:${PORT}`);
  console.log(`Access the Shelby County Parcel Viewer at http://localhost:${PORT}/index.html`);
});
