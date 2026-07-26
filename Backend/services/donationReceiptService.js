const PDFDocument = require("pdfkit");

function generateDonationReceiptPDF(txn) {
  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({ size: "A4", margin: 50 });
    const chunks = [];
    doc.on("data", (c) => chunks.push(c));
    doc.on("end", () => resolve(Buffer.concat(chunks)));
    doc.on("error", reject);

    // Header
    doc
      .fillColor("#b91c1c")
      .fontSize(22)
      .text("UIU Sanatani Vidyarthi Samsad", { align: "center" })
      .fontSize(11)
      .fillColor("#7c2d12")
      .text("United City, Madani Avenue, Dhaka-1212", { align: "center" })
      .moveDown(1.5);

    doc
      .fillColor("#000")
      .fontSize(16)
      .text("Donation Receipt", { align: "center", underline: true })
      .moveDown(1);

    const rows = [
      ["Receipt No.", `UIUSVS-${txn.id}`],
      ["Date", new Date(txn.created_at).toLocaleDateString("en-GB")],
      ["Donor Name", txn.member_name || txn.donor_name],
      ["Campaign", txn.campaign_title],
      ["Transaction", txn.transaction_name],
      ["Amount", `৳ ${Number(txn.amount).toLocaleString("en-BD")}`],
    ];

    rows.forEach(([label, value]) => {
      doc
        .fontSize(11)
        .fillColor("#4a0404")
        .text(label, 60, doc.y, { continued: true, width: 150 })
        .fillColor("#000")
        .text(`   ${value}`);
      doc.moveDown(0.4);
    });

    doc
      .moveDown(2)
      .fontSize(10)
      .fillColor("#888")
      .text(
        "This receipt confirms a voluntary donation and is not a legally binding tax document. Thank you for supporting Sanatani student life at UIU.",
        { align: "center" },
      );

    doc.end();
  });
}

module.exports = { generateDonationReceiptPDF };
