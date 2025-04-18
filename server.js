// Proxy server for Shelby County Parcel Viewer
const express = require('express');
const axios = require('axios');
const cors = require('cors');
const bodyParser = require('body-parser');
const path = require('path');

const app = express();
const PORT = process.env.PORT || 901;

// Configure CORS
const corsOptions = {
  origin: function (origin, callback) {
    // Allow requests from specific origins or if no origin (like server-to-server or REST tools)
    const allowedOrigins = ['https://records.suify.com', 'http://localhost:901']; // Add other local dev ports if needed
    // Allow requests with no origin (like mobile apps or curl requests)
    if (!origin || allowedOrigins.indexOf(origin) !== -1 || origin.startsWith('http://localhost:')) {
      callback(null, true)
    } else {
      callback(new Error('Not allowed by CORS'))
    }
  },
  methods: "GET,POST", // Allow common methods
  credentials: true // Allow cookies if needed in the future
};

app.use(cors(corsOptions));

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

// Start the server
app.listen(PORT, () => {
  console.log(`Proxy server running at http://localhost:${PORT}`);
  console.log(`Access the Shelby County Parcel Viewer at http://localhost:${PORT}/index.html`);
});
