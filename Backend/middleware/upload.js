const multer = require("multer");

const upload = multer({
  storage: multer.memoryStorage(),
  fileFilter: (req, file, cb) => {
    const allowedTypes = ["image/jpeg", "image/png", "image/webp", "video/mp4"];
    if (allowedTypes.includes(file.mimetype)) {
      cb(null, true);
    } else {
      cb(new Error("Unsupported file type: " + file.mimetype), false);
    }
  },
  limits: { fileSize: 50 * 1024 * 1024 }, // 50MB — video-r jonno dorkar
});

module.exports = upload;
