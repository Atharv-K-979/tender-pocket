// @ts-ignore
import HTMLtoDOCX from 'html-to-docx';
import JSZip from 'jszip';
import fs from 'fs';
import { getDocxFooterHtml } from '../src/lib/documentTemplates';

async function testFooter() {
  const footerHtml = getDocxFooterHtml('healthtech');
  console.log('--- Input footerHtml length: ' + footerHtml.length);

  const docx = await HTMLtoDOCX('<p>Hello world</p>', null, { footer: true }, footerHtml);
  const zip = await JSZip.loadAsync(docx);
  const ftr = await zip.file('word/footer1.xml')?.async('text');
  console.log('--- Output word/footer1.xml ---');
  console.log(ftr);
}
testFooter().catch(console.error);
