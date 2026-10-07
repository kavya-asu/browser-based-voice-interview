import test from "node:test";
import assert from "node:assert/strict";
import JSZip from "jszip";
import { extractAssignmentText } from "./extract-assignment.js";

test("extracts PPTX slide text in numeric order for assignments and rubrics", async () => {
  const zip = new JSZip();
  zip.file("ppt/slides/slide10.xml", '<p:sld><a:t>Tenth slide</a:t></p:sld>');
  zip.file("ppt/slides/slide2.xml", '<p:sld><a:t>Second &amp; &lt;important&gt;</a:t><a:t>point</a:t></p:sld>');
  zip.file("ppt/slides/slide1.xml", '<p:sld><a:t>First &#x1F9EC; slide</a:t></p:sld>');
  zip.file("ppt/notesSlides/notesSlide1.xml", '<a:t>Not visible slide text</a:t>');
  const buffer = await zip.generateAsync({ type: "nodebuffer" });
  const expected = "Slide 1: First 🧬 slide Slide 2: Second & <important> point Slide 10: Tenth slide";
  assert.equal(await extractAssignmentText(buffer, "assignment.pptx"), expected);
  assert.equal(await extractAssignmentText(buffer, "rubric", "application/vnd.openxmlformats-officedocument.presentationml.presentation"), expected);
});

test("rejects presentations without readable slide text and legacy PPT", async () => {
  const zip = new JSZip();
  zip.file("ppt/slides/slide1.xml", "<p:sld><p:sp/></p:sld>");
  const buffer = await zip.generateAsync({ type: "nodebuffer" });
  await assert.rejects(extractAssignmentText(buffer, "image-only.pptx"), /No readable text/);
  await assert.rejects(extractAssignmentText(buffer, "old.ppt"), /Unsupported file type/);
});