// pdf.js ships its worker as a plain module without types. Only its presence matters: save-link
// hands it to pdf.js so PDFs are parsed in this process (see loadPdfJs there).
declare module "pdfjs-dist/legacy/build/pdf.worker.mjs";
