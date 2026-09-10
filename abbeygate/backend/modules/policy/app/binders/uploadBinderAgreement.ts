type UseCaseResult = {
  status: number;
  body: Record<string, unknown>;
};

type UploadFileInput = {
  originalname: string;
  mimetype: string;
  size: number;
  buffer: Buffer;
};

type UnknownRecord = Record<string, unknown>;

function extractAllCodes(text: string): string[] {
  const codes = new Set<string>();
  const re = /\b(?:LBS|LMA|NMA)\s*0*\d{3,5}[A-Z]?\b/gi;
  let match: RegExpExecArray | null;
  while ((match = re.exec(String(text || ''))) !== null) {
    codes.add(match[0].replace(/\s+/g, '').toUpperCase());
  }
  return Array.from(codes);
}

function extractParagraphs(text: string): string[] {
  return String(text || '')
    .split(/\n{2,}/g)
    .map((paragraph) => paragraph.replace(/\s+/g, ' ').trim())
    .filter(Boolean);
}

export type UploadBinderAgreementInput = {
  file: UploadFileInput | null;
  actor: { actorId: string; actorType: 'USER' | 'SYSTEM' };
  env: { nodeEnv?: string; embeddingsProvider?: string | null };
};

export type UploadBinderAgreementDeps = {
  parser: {
    parsePdf(buffer: Buffer): Promise<{ text: string }>;
    recognizeImage(
      buffer: Buffer,
      onProgress?: (progress: unknown) => void
    ): Promise<{ text: string }>;
  };
  storage: {
    uploadFile(
      buffer: Buffer,
      filename: string,
      mimeType: string
    ): Promise<{ filename: string; url: string }>;
  };
  repo: {
    createBinder(data: {
      umr: string;
      agreementNumber: string;
      coverholderName: string;
      lloydsReportingVer: string;
      defaultCurrency: string;
      settlementCurrency: string;
      startDate: Date;
      endDate: Date;
      status: string;
      config: UnknownRecord;
    }): Promise<{
      id: string;
      agreementNumber: string;
      umr: string;
      [key: string]: unknown;
    }>;
    createBinderDocument(data: {
      binderId: string;
      type: string;
      name: string;
      filename: string;
      storageUri: string;
      mimeType: string;
      sizeBytes: number;
      meta: UnknownRecord;
    }): Promise<void>;
    createBinderClause(data: {
      binderId: string;
      clauseType: string;
      textFragment: string;
      pointer: UnknownRecord;
      codes: string[];
      meta: UnknownRecord;
    }): Promise<void>;
  };
  audit: {
    logUploadedAndParsed(args: {
      binderId: string;
      actorId: string;
      actorType: 'USER' | 'SYSTEM';
      agreementNumber: string;
      umr: string;
      document: string;
      codesFound: number;
    }): Promise<void>;
  };
  logger: {
    info(message: string | UnknownRecord): void;
    error(payload: UnknownRecord, message?: string): void;
  };
};

export async function uploadBinderAgreementUseCase(
  input: UploadBinderAgreementInput,
  deps: UploadBinderAgreementDeps
): Promise<UseCaseResult> {
  deps.logger.info('📂 [Binder Upload] Request received');

  if (!input.file) {
    deps.logger.error({}, '❌ [Binder Upload] No file in request');
    return { status: 400, body: { success: false, error: 'No file uploaded' } };
  }

  const file = input.file;
  deps.logger.info(
    `📄 [Binder Upload] File received: ${file.originalname} (${file.size} bytes, type: ${file.mimetype})`
  );

  const dataBuffer = file.buffer;
  const isImage = file.mimetype.startsWith('image/');
  let text = '';

  if (isImage) {
    deps.logger.info('📷 [Binder Upload] Detected Image. Running OCR (Tesseract)...');
    try {
      const ocr = await deps.parser.recognizeImage(dataBuffer, (progress) => {
        deps.logger.info(progress as UnknownRecord);
      });
      text = ocr.text;
      deps.logger.info(`✅ [Binder Upload] OCR Complete. Text length: ${text.length}`);
    } catch (ocrError) {
      deps.logger.error({ err: ocrError }, '❌ [Binder Upload] OCR Failed:');
      return {
        status: 500,
        body: {
          success: false,
          error: {
            code: 'OCR_FAILED',
            message:
              'OCR Processing Failed: ' +
              (ocrError instanceof Error ? ocrError.message : String(ocrError)),
          },
        },
      };
    }
  } else {
    try {
      deps.logger.info('🔍 [Binder Upload] Parsing PDF...');
      const pdf = await deps.parser.parsePdf(dataBuffer);
      text = pdf.text;
      deps.logger.info(`✅ [Binder Upload] PDF Parsed successfully. Text length: ${text?.length || 0}`);
    } catch (parseError) {
      deps.logger.error({ err: parseError }, '❌ [Binder Upload] PDF Parse Failed:');
      return {
        status: 500,
        body: {
          success: false,
          error: {
            code: 'PDF_PARSE_FAILED',
            message:
              'Failed to parse PDF file: ' +
              (parseError instanceof Error ? parseError.message : String(parseError)),
          },
        },
      };
    }
  }

  const scheduleIndex = text.indexOf('SCHEDULE');
  const processingText = scheduleIndex > -1 ? text.substring(scheduleIndex) : text;
  const secRegex = /Sub-sec(?:ti|O)on/i;

  const extract = (pattern: RegExp) => {
    const match = processingText.match(pattern);
    return match ? match[1].trim() : null;
  };

  const extractSection = (
    headerRegex: RegExp,
    stopperRegex: RegExp,
    preserveLines = false
  ) => {
    const fullRegex = new RegExp(
      `${headerRegex.source}([\\s\\S]*?)(?:${stopperRegex.source}|$)`,
      'i'
    );
    const match = processingText.match(fullRegex);
    if (!match) return null;
    const content = match[1].trim();
    if (preserveLines) return content.replace(/\r\n/g, '\n').trim();
    return content.replace(/\n/g, ' ').replace(/\s+/g, ' ').trim();
  };

  const periodDetailedRaw =
    extractSection(/Sub-sec(?:ti|O)on 2.1[^\n]*:?\s*/, secRegex, true) || '';
  const periodDetailed = periodDetailedRaw
    .replace(/Kme/g, 'time')
    .replace(/(\d+)\s*\n\s*(st|nd|rd|th)\s*\n\s*/gi, '$1$2 ')
    .replace(/From:\s*\n+/gi, 'From: ')
    .replace(/To:\s*\n+/gi, 'To: ')
    .replace(/\n\s+/g, '\n');

  const monthGroup =
    '(?:Jan(?:uary)?|Feb(?:ruary)?|Mar(?:ch)?|Apr(?:il)?|May|Jun(?:e)?|Jul(?:y)?|Aug(?:ust)?|Sep(?:t(?:ember)?)?|Oct(?:ober)?|Nov(?:ember)?|Dec(?:ember)?)';
  const fromMatch = periodDetailed.match(
    new RegExp(
      `From:[\\s\\S]*?(\\d{1,2})(?:st|nd|rd|th)?[\\s\\S]*?(${monthGroup})[\\s\\S]*?(\\d{4})`,
      'i'
    )
  );
  const toMatch = periodDetailed.match(
    new RegExp(
      `To:[\\s\\S]*?(\\d{1,2})(?:st|nd|rd|th)?[\\s\\S]*?(${monthGroup})[\\s\\S]*?(\\d{4})`,
      'i'
    )
  );

  const parseFoundDate = (
    day: string,
    month: string,
    year: string,
    fallback: Date
  ) => {
    const cleanDateString = `${month} ${day}, ${year}`.replace(/\n|\|/g, '');
    const parsed = new Date(cleanDateString);
    if (Number.isNaN(parsed.getTime()) || parsed.getFullYear() < 2000) return fallback;
    return parsed;
  };

  const startDate = fromMatch
    ? parseFoundDate(fromMatch[1], fromMatch[2], fromMatch[3], new Date())
    : new Date();
  const endDate = toMatch
    ? parseFoundDate(toMatch[1], toMatch[2], toMatch[3], new Date())
    : new Date();

  const createRegex = (keys: string[]) =>
    new RegExp(`(?:${keys.join('|')}):?\\s*([^\\n\\r]+)`, 'i');
  const cleanValue = (val: string | null) => {
    if (!val) return null;
    const lower = val.toLowerCase().trim();
    if (/a[\w\W]ached\s*hereto/i.test(lower)) return null;
    if (/unique\s*market/i.test(lower)) return null;
    if (/^and\s+.*/i.test(lower)) return null;
    if (/^(?:agreement|reference)$/i.test(lower)) return null;
    if (lower.length < 3) return null;
    return val.trim();
  };

  const agreementMatch = text.match(/(ABBEYGATE\d{4}(?:-\d+)?)/i);
  const agreementNumber =
    agreementMatch?.[1] ||
    cleanValue(extract(createRegex(['Agreement Number', 'Binder Number', 'Contract No']))) ||
    'ABBEYGATE0125';
  // The UMR is the binder's market reference — it must be read from the
  // agreement, never guessed. If extraction fails we reject the upload so an
  // operator can supply the real value, rather than persisting a binder with
  // a fabricated reference that would then propagate onto every policy
  // (no-defensive-fallbacks).
  const umr = cleanValue(
    extract(
      createRegex(['Unique Market Reference Number', 'UMR', 'Market Reference'])
    )
  );
  if (!umr) {
    return {
      status: 422,
      body: {
        success: false,
        error: {
          code: 'UMR_NOT_FOUND',
          message:
            'Could not read a Unique Market Reference (UMR) from the uploaded agreement. ' +
            'The UMR must not be guessed — upload a clearer copy of the binder, or create the binder manually and enter the UMR.',
        },
      },
    };
  }

  let coverholder = cleanValue(
    extract(createRegex(['Name of Coverholder', 'Coverholder Name', 'Coverholder']))
  );
  if (
    coverholder &&
    (coverholder.toLowerCase().includes('authority') ||
      coverholder.toLowerCase().includes('address'))
  ) {
    coverholder = null;
  }
  if (!coverholder) {
    const coverholderMatch = text.match(/(Abbeygate\s*UW\s*Ltd\.?)/i);
    coverholder = coverholderMatch ? coverholderMatch[1] : 'Coverholder';
  }

  const uploaded = await deps.storage.uploadFile(
    dataBuffer,
    file.originalname,
    file.mimetype
  );

  const hasOrphanidesMurat = /Orphanides\s+and\s+Murat/i.test(text);
  const claimsOpsDefaults = hasOrphanidesMurat
    ? {
        claimsAuthorityGranted: true,
        tpaName: 'Orphanides and Murat Ltd',
        tpaAuthorityLimit: 20000,
        claimsFundLimit: 50000,
        largeLossThreshold: 20000,
        workingDaysJurisdiction: 'CY',
      }
    : {
        claimsAuthorityGranted: false,
        tpaAuthorityLimit: 0,
        claimsFundLimit: 0,
      };

  const cfg: UnknownRecord = {
    binderCode: agreementNumber,
    binderName: coverholder,
    umr,
    schedule: {
      agreementNumber,
      umr,
      period: {
        from: startDate.toISOString().slice(0, 10),
        to: endDate.toISOString().slice(0, 10),
      },
    },
    authority: { canBind: true, canCollectPremiums: true, handleClaims: true },
    operations: { claims: claimsOpsDefaults },
    parties: [{ role: 'appointed_coverholder', party_subtype: 'appointed', name: coverholder }],
    parse: {
      latest: {
        source: {
          filename: file.originalname,
          mimetype: file.mimetype,
          size: file.size,
          isImage,
        },
        extractedAt: new Date().toISOString(),
        confidence: {
          umr: umr ? 0.85 : 0,
          agreementNumber: agreementNumber ? 0.85 : 0,
          period: 0.75,
        },
      },
    },
  };

  const binder = await deps.repo.createBinder({
    umr,
    agreementNumber,
    coverholderName: coverholder,
    lloydsReportingVer: 'V5.2',
    defaultCurrency: 'USD',
    settlementCurrency: 'USD',
    startDate,
    endDate,
    status: 'DRAFT',
    config: cfg,
  });

  await deps.repo.createBinderDocument({
    binderId: binder.id,
    type: 'agreement',
    name: file.originalname,
    filename: uploaded.filename,
    storageUri: uploaded.url,
    mimeType: file.mimetype,
    sizeBytes: file.size,
    meta: { extractedTextLength: text.length },
  });

  const codes = extractAllCodes(text);
  if (codes.length > 0) {
    const paragraphs = extractParagraphs(text);
    for (const code of codes) {
      const fragment = paragraphs.find((paragraph) =>
        paragraph.toUpperCase().includes(code)
      ) || code;
      await deps.repo.createBinderClause({
        binderId: binder.id,
        clauseType: 'wording',
        textFragment: fragment,
        pointer: { source: 'upload_text', code },
        codes: [code],
        meta: {
          extracted: true,
          embeddingProvider: input.env.embeddingsProvider || null,
        },
      });
    }
  }

  await deps.audit.logUploadedAndParsed({
    binderId: binder.id,
    actorId: input.actor.actorId,
    actorType: input.actor.actorType,
    agreementNumber: binder.agreementNumber,
    umr: binder.umr,
    document: uploaded.filename,
    codesFound: codes.length,
  });

  return {
    status: 200,
    body: { success: true, data: binder },
  };
}
