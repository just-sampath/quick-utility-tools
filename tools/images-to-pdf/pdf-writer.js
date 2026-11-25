const enc = new TextEncoder();

async function deflate(bytes) {
  const stream = new Blob([bytes]).stream().pipeThrough(new CompressionStream("deflate"));
  return new Uint8Array(await new Response(stream).arrayBuffer());
}

export async function flate(bytes) {
  return deflate(bytes);
}

export function createPdf() {
  const chunks = [];
  const offsets = [];
  let length = 0;

  function push(part) {
    const bytes = typeof part === "string" ? enc.encode(part) : part;
    chunks.push(bytes);
    length += bytes.length;
  }

  push("%PDF-1.4\n%\xE2\xE3\xCF\xD3\n");

  return {
    reserve() {
      offsets.push(0);
      return offsets.length;
    },
    object(id, dict, stream) {
      offsets[id - 1] = length;
      push(`${id} 0 obj\n`);
      if (stream) {
        push(`<< ${dict} /Length ${stream.length} >>\nstream\n`);
        push(stream);
        push("\nendstream\nendobj\n");
      } else {
        push(`${dict}\nendobj\n`);
      }
    },
    finish(rootId, infoId) {
      const xref = length;
      let table = `xref\n0 ${offsets.length + 1}\n0000000000 65535 f \n`;
      for (const off of offsets) table += String(off).padStart(10, "0") + " 00000 n \n";
      push(table);
      push(`trailer\n<< /Size ${offsets.length + 1} /Root ${rootId} 0 R /Info ${infoId} 0 R >>\nstartxref\n${xref}\n%%EOF\n`);
      return new Blob(chunks, { type: "application/pdf" });
    },
  };
}
