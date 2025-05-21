// Proxy server for Shelby County Parcel Viewer
const express = require('express');
const axios = require('axios');
const cors = require('cors');
const bodyParser = require('body-parser');
const path = require('path');
const { exec } = require('child_process'); // Added for curl

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
    const userAgent = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36';

    // Construct the curl command
    // Simplified: -v for verbose, --fail for server errors, -s for silent (progress), -L for redirects, --insecure for SSL leniency.
    const command = `curl -v --fail -s -L --insecure -A "${userAgent}" "${trusteeUrl}" --compressed`;

    try {
        console.log(`TRUSTEE PROXY (server.js via curl - simplified): Requesting data for Parcel ID '${parcelIdQuery}' from ${trusteeUrl}`);
        
        exec(command, { timeout: 20000, maxBuffer: 1024 * 1024 * 5 }, (error, stdout, stderr) => {
            if (error) {
                console.error(`TRUSTEE PROXY EXEC ERROR (server.js) for Parcel ID '${parcelIdQuery}':`, error.message);
                console.error(`Curl stderr: ${stderr}`);
                // Distinguish between different types of errors
                if (error.killed) {
                    res.status(504).send('Request to Trustee website timed out (curl proxy).');
                } else if (stderr.includes('Could not resolve host') || stderr.includes('SSL')) {
                     res.status(502).send('Bad Gateway: Error connecting to Trustee website (curl proxy - network/SSL issue). Check server logs.');
                } else {
                    res.status(500).send('Server error while attempting to proxy request to Trustee website (curl proxy). Check server logs.');
                }
                return;
            }

            if (stdout) {
                res.send(stdout);
            } else {
                console.warn(`TRUSTEE PROXY (server.js via curl): No stdout received for Parcel ID '${parcelIdQuery}', but no error. Stderr: ${stderr}`);
                res.status(204).send(); // No content, but request was successful
            }
        });

    } catch (error) {
        // This outer catch is less likely to be hit with exec's callback model but kept for safety
        console.error(`TRUSTEE PROXY GENERIC CATCH ERROR (server.js) for Parcel ID '${parcelIdQuery}':`, error.message);
        res.status(500).send('Server error while attempting to proxy request to Trustee website (server.js general).');
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

// Start the server
app.listen(PORT, () => {
  console.log(`Proxy server running at http://localhost:${PORT}`);
  console.log(`Access the Shelby County Parcel Viewer at http://localhost:${PORT}/index.html`);
});
