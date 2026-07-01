const express = require('express');
const multer = require('multer');
const cloudinary = require('cloudinary').v2;
const { CloudinaryStorage } = require('multer-storage-cloudinary');
const cors = require('cors');
require('dotenv').config();

const app = express();
app.use(cors());
app.use(express.json());

// Cloudinary Configuration
cloudinary.config({
    cloud_name: process.env.CLOUDINARY_CLOUD_NAME,
    api_key: process.env.CLOUDINARY_API_KEY,
    api_secret: process.env.CLOUDINARY_API_SECRET
});

// Configure Multer to use Cloudinary
const storage = new CloudinaryStorage({
    cloudinary: cloudinary,
    params: {
        folder: 'uiusvs_uploads',
        allowed_formats: ['jpg', 'png', 'jpeg', 'webp', 'mp4'],
    },
});

const upload = multer({ storage: storage });

// Example API Route for Gallery Upload
app.post('/api/gallery', upload.single('media'), async (req, res) => {
    try {
        const { title, category, isPinned } = req.body;
        const imageUrl = req.file.path; // Cloudinary secure URL

        // এখানে আপনার TiDB ডাটাবেসে তথ্য সেভ করার কোড লিখুন
        // উদাহরণ: await db.query('INSERT INTO gallery ...', [title, imageUrl, category, isPinned]);

        res.status(200).json({ 
            message: 'Media uploaded successfully!', 
            url: imageUrl 
        });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

app.listen(4000, () => {
    console.log('Server running on port 4000');
});