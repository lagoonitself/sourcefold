// pdf.js ships its worker as a plain module without types. Only its presence matters: the source
// client hands it to pdf.js so PDFs are parsed on this thread (see features/sources).
declare module "pdfjs-dist/build/pdf.worker.mjs";
