import express from 'express';
import path from 'path';
import { fileURLToPath } from 'url';
import { createServer as createViteServer } from 'vite';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
const PORT = process.env.PORT || 3000;

// Raw body parser so request payload can be forwarded accurately
app.use(express.raw({ type: '*/*', limit: '30mb' }));

// CORS headers
app.use((req, res, next) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, PATCH, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', '*');
  res.setHeader('Access-Control-Expose-Headers', '*');
  if (req.method === 'OPTIONS') {
    return res.sendStatus(200);
  }
  next();
});

// Upstream proxy function
async function proxyTo(targetBase: string, targetPath: string, req: express.Request, res: express.Response) {
  const queryIdx = req.url.indexOf('?');
  const queryStr = queryIdx !== -1 ? req.url.slice(queryIdx) : '';
  const cleanPath = targetPath.startsWith('/') ? targetPath : `/${targetPath}`;
  const targetUrl = `${targetBase.replace(/\/+$/, '')}${cleanPath}${queryStr}`;

  const headers: Record<string, string> = {
    'Origin': 'https://pw.eduvibe.cc.cd',
    'Referer': 'https://pw.eduvibe.cc.cd/',
    'User-Agent': (req.headers['user-agent'] as string) || 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36',
    'Accept': (req.headers['accept'] as string) || '*/*',
    'x-platform': (req.headers['x-platform'] as string) || 'PW',
  };

  const forwardHeaderKeys = [
    'authorization',
    'x-request-signature',
    'x-request-timestamp',
    'x-puzzle-nonce',
    'x-xsrf-token',
    'x-status-ticket',
    'x-eduvibe-pass',
    'x-new-pw-token',
    'content-type',
    'range'
  ];

  for (const k of forwardHeaderKeys) {
    const v = req.headers[k];
    if (v && typeof v === 'string') {
      if (k === 'authorization' && targetBase.includes('penpencil') && v.includes('pw_eduvibe')) {
        continue;
      }
      headers[k] = v;
    }
  }

  try {
    const fetchOptions: RequestInit = {
      method: req.method,
      headers,
    };

    if (req.method !== 'GET' && req.method !== 'HEAD' && req.body && Buffer.isBuffer(req.body) && req.body.length > 0) {
      fetchOptions.body = new Uint8Array(req.body);
    }

    const upstreamRes = await fetch(targetUrl, fetchOptions);

    res.status(upstreamRes.status);

    const exposed = ['content-type', 'x-xsrf-token', 'x-new-pw-token', 'x-download-filename', 'content-disposition', 'content-range'];
    for (const h of exposed) {
      const v = upstreamRes.headers.get(h);
      if (v) res.setHeader(h, v);
    }
    res.setHeader('Access-Control-Allow-Origin', '*');

    const buf = Buffer.from(await upstreamRes.arrayBuffer());
    res.send(buf);
  } catch (err: any) {
    console.error(`Proxy failed for ${targetUrl}:`, err.message);
    res.status(502).json({ error: 'Proxy request failed', message: err.message });
  }
}

// 1. Status endpoints (intercepted by status tracker in index.js)
app.all(['/status', '/api/status', '/api/status/*'], async (req, res) => {
  let subPath = req.path.replace(/^\/api\/status/, '');
  if (!subPath || subPath === '/') subPath = '/status';
  if (!subPath.startsWith('/')) subPath = `/${subPath}`;

  try {
    const upstreamRes = await fetch(`https://status.eduvibe.cc.cd${subPath}`, {
      method: req.method,
      headers: {
        'Origin': 'https://pw.eduvibe.cc.cd',
        'Referer': 'https://pw.eduvibe.cc.cd/',
        'x-platform': 'PW',
        'Accept': 'application/json',
      },
    });

    if (upstreamRes.ok) {
      const data = await upstreamRes.json();
      return res.json(data);
    }
  } catch (err: any) {
    console.warn('Status upstream error, returning active status fallback:', err.message);
  }

  res.json({
    status: 'ok',
    platform: 'PhysicsWallah',
    maintenance: false,
    message: '',
    ticket: `PW_MIRROR_${Date.now()}`,
    keygen: { enabled: false, hasValidPass: true, pass: '', expiresAt: Date.now() + 86400000 }
  });
});

// Cache for batches list
let batchesMap: Map<string, any> = new Map();
let lastBatchesFetch = 0;

async function getBatchFromList(batchId: string): Promise<any> {
  const now = Date.now();
  if (batchesMap.size === 0 || now - lastBatchesFetch > 3600000) {
    try {
      const upstreamRes = await fetch('https://api.penpencil.cc.cd/batches', {
        headers: {
          'Origin': 'https://pw.eduvibe.cc.cd',
          'Referer': 'https://pw.eduvibe.cc.cd/',
          'x-platform': 'PW',
          'User-Agent': 'Mozilla/5.0',
        },
      });
      if (upstreamRes.ok) {
        const json: any = await upstreamRes.json();
        const list = Array.isArray(json?.batches) ? json.batches : [];
        for (const b of list) {
          const bId = b.batch_id || b.batchId || b._id;
          if (bId) batchesMap.set(String(bId), b);
        }
        lastBatchesFetch = now;
      }
    } catch (err: any) {
      console.warn('Failed to fetch batch list for cache:', err.message);
    }
  }
  return batchesMap.get(batchId) || null;
}

function getBatchDetailsPayload(batchId: string, meta: any) {
  const name = meta?.name || 'Physics Wallah Batch';
  const nameLower = name.toLowerCase();
  const exam = (meta?.exam || '').toLowerCase();
  const cls = String(meta?.class || '');

  let subjectNames: string[] = [];
  if (exam.includes('neet') || nameLower.includes('neet') || nameLower.includes('yakeen')) {
    subjectNames = ['Physics', 'Chemistry', 'Botany', 'Zoology'];
  } else if (exam.includes('jee') || nameLower.includes('jee') || nameLower.includes('arjuna') || nameLower.includes('lakshya') || nameLower.includes('prayas')) {
    subjectNames = ['Physics', 'Chemistry', 'Mathematics'];
  } else if (cls === '10' || cls === '9' || nameLower.includes('10th') || nameLower.includes('9th')) {
    subjectNames = ['Science', 'Mathematics', 'Social Science', 'English', 'Hindi'];
  } else if (nameLower.includes('bihar') || nameLower.includes('board')) {
    subjectNames = ['Physics', 'Chemistry', 'Mathematics', 'Biology', 'Hindi', 'English'];
  } else if (exam.includes('clat') || nameLower.includes('clat')) {
    subjectNames = ['Legal Reasoning', 'Current Affairs & GK', 'Logical Reasoning', 'English Language', 'Quantitative Techniques'];
  } else {
    subjectNames = ['Physics', 'Chemistry', 'Mathematics', 'Biology', 'English'];
  }

  const defaultTeachers = [
    {
      _id: 't_alakh',
      id: 't_alakh',
      name: 'Alakh Pandey Sir',
      teacherImage: 'https://static.pw.live/5eb393ee95fab7468a79d189/ADMIN/alakh_pandey.png',
    },
    {
      _id: 't_rajwant',
      id: 't_rajwant',
      name: 'Rajwant Sir',
      teacherImage: 'https://static.pw.live/5eb393ee95fab7468a79d189/ADMIN/rajwant_sir.png',
    },
    {
      _id: 't_sarvesh',
      id: 't_sarvesh',
      name: 'Sarvesh Sir',
      teacherImage: 'https://static.pw.live/5eb393ee95fab7468a79d189/ADMIN/sarvesh_sir.png',
    },
    {
      _id: 't_sachin',
      id: 't_sachin',
      name: 'Sachin Sir',
      teacherImage: 'https://static.pw.live/5eb393ee95fab7468a79d189/ADMIN/sachin_sir.png',
    },
  ];

  const subjects = subjectNames.map((sName, idx) => {
    const sId = `sub_${batchId}_${idx + 1}`;
    const teacher = defaultTeachers[idx % defaultTeachers.length];
    return {
      _id: sId,
      id: sId,
      subjectId: sId,
      name: sName,
      subjectName: sName,
      teacherIds: [teacher.id],
      teachers: [teacher],
      photo: meta?.photo || '',
      status: 'active',
      totalLectures: 35,
      completedLectures: 0,
      totalExercises: 15,
    };
  });

  return {
    _id: batchId,
    batchId: batchId,
    id: batchId,
    name: name,
    byName: meta?.byName || 'Physics Wallah',
    description: `Complete syllabus coverage for ${name}. Includes live interactive lectures, comprehensive lecture notes, Daily Practice Problems (DPP) with video solutions, and regular test series.`,
    fee: {
      total: meta?.amount || 999,
      discounted: meta?.amount || 999,
    },
    amount: meta?.amount || 999,
    photo: meta?.photo || 'https://static.pw.live/5eb393ee95fab7468a79d189/ADMIN/aab6aaeb-3d24-4c63-a1e9-9f1343fc44b1.png',
    imageUrl: meta?.photo || 'https://static.pw.live/5eb393ee95fab7468a79d189/ADMIN/aab6aaeb-3d24-4c63-a1e9-9f1343fc44b1.png',
    image: meta?.photo || '',
    language: meta?.language || 'Hindi',
    class: meta?.class || '12',
    exam: meta?.exam || 'School Preparation',
    startDate: meta?.start_date || meta?.startDate || '2026-10-20T18:30:00.000Z',
    endDate: meta?.end_date || meta?.endDate || '2027-03-31T18:29:59.000Z',
    subjects,
    resources: [],
    teachers: defaultTeachers,
    _sections: {
      teachers: {
        data: defaultTeachers,
      },
    },
  };
}

function generateContentList(batchId: string, subjectId: string, contentType: string, tagId: string) {
  const cType = (contentType || 'LECTURES').toUpperCase();

  if (cType === 'NOTES') {
    return [1, 2, 3, 4].map(num => ({
      _id: `note_${batchId}_${subjectId}_${tagId}_${num}`,
      topic: `Lecture 0${num} : Class Notes & Formula Summary`,
      name: `Lecture 0${num} : Class Notes & Formula Summary`,
      type: 'NOTES',
      date: new Date(Date.now() - num * 86400000).toISOString(),
      homeworkIds: [
        {
          _id: `hw_note_${num}`,
          topic: `Lecture 0${num} Notes`,
          name: `Lecture 0${num} Notes`,
          attachmentIds: [
            {
              name: `Lecture_0${num}_Notes.pdf`,
              baseUrl: 'https://static.pw.live/',
              key: '5eb393ee95fab7468a79d189/ADMIN/sample.pdf',
            },
          ],
        },
      ],
      attachmentIds: [
        {
          name: `Lecture_0${num}_Notes.pdf`,
          baseUrl: 'https://static.pw.live/',
          key: '5eb393ee95fab7468a79d189/ADMIN/sample.pdf',
        },
      ],
    }));
  }

  if (cType === 'DPP_PDF') {
    return [1, 2, 3, 4].map(num => ({
      _id: `dpp_pdf_${batchId}_${subjectId}_${tagId}_${num}`,
      topic: `DPP 0${num} : Practice Problems & Question Sheet`,
      name: `DPP 0${num} : Practice Problems & Question Sheet`,
      type: 'DPP_PDF',
      date: new Date(Date.now() - num * 86400000).toISOString(),
      homeworkIds: [
        {
          _id: `hw_dpp_${num}`,
          topic: `DPP 0${num}`,
          note: 'DPP',
          name: `DPP 0${num}`,
          attachmentIds: [
            {
              name: `DPP_0${num}_Problems.pdf`,
              baseUrl: 'https://static.pw.live/',
              key: '5eb393ee95fab7468a79d189/ADMIN/sample.pdf',
            },
          ],
        },
      ],
      attachmentIds: [
        {
          name: `DPP_0${num}_Problems.pdf`,
          baseUrl: 'https://static.pw.live/',
          key: '5eb393ee95fab7468a79d189/ADMIN/sample.pdf',
        },
      ],
    }));
  }

  if (cType === 'DPP_VIDEOS') {
    return [1, 2, 3, 4].map(num => ({
      _id: `dpp_vid_${batchId}_${subjectId}_${tagId}_${num}`,
      topic: `DPP 0${num} Video Solution & Discussion`,
      name: `DPP 0${num} Video Solution & Discussion`,
      type: 'DPP_VIDEOS',
      date: new Date(Date.now() - num * 86400000).toISOString(),
      videoId: `dpp_vid_id_${num}`,
      videoDetails: {
        duration: '00:32:15',
        videoUrl: 'https://www.youtube.com/watch?v=dQw4w9WgXcQ',
      },
      urlType: 'youtube',
    }));
  }

  // Default: LECTURES
  return [
    {
      _id: `lec_${batchId}_${subjectId}_${tagId}_1`,
      topic: 'Lecture 01 : Fundamentals, Theory & Prerequisites',
      name: 'Lecture 01 : Fundamentals, Theory & Prerequisites',
      type: 'LECTURES',
      date: new Date(Date.now() - 4 * 86400000).toISOString(),
      videoId: `vid_${batchId}_1`,
      videoDetails: {
        duration: '01:25:30',
        videoUrl: 'https://www.youtube.com/watch?v=dQw4w9WgXcQ',
      },
      urlType: 'youtube',
      teacherDetails: {
        name: 'Faculty PW',
      },
      homeworkIds: [
        {
          _id: `hw_${batchId}_1`,
          topic: 'Lecture 01 Class Notes',
          name: 'Lecture 01 Class Notes',
          attachmentIds: [
            {
              name: 'Lecture_01_Notes.pdf',
              baseUrl: 'https://static.pw.live/',
              key: '5eb393ee95fab7468a79d189/ADMIN/sample.pdf',
            },
          ],
        },
      ],
      exerciseIds: [
        {
          _id: `ex_${batchId}_1`,
          topic: 'DPP 01 Quiz',
          name: 'DPP 01 Quiz',
          totalQuestions: 10,
        },
      ],
    },
    {
      _id: `lec_${batchId}_${subjectId}_${tagId}_2`,
      topic: 'Lecture 02 : Core Syllabus Concepts & Detailed Derivations',
      name: 'Lecture 02 : Core Syllabus Concepts & Detailed Derivations',
      type: 'LECTURES',
      date: new Date(Date.now() - 3 * 86400000).toISOString(),
      videoId: `vid_${batchId}_2`,
      videoDetails: {
        duration: '01:30:15',
        videoUrl: 'https://www.youtube.com/watch?v=dQw4w9WgXcQ',
      },
      urlType: 'youtube',
      teacherDetails: {
        name: 'Faculty PW',
      },
      homeworkIds: [
        {
          _id: `hw_${batchId}_2`,
          topic: 'Lecture 02 Class Notes',
          name: 'Lecture 02 Class Notes',
          attachmentIds: [
            {
              name: 'Lecture_02_Notes.pdf',
              baseUrl: 'https://static.pw.live/',
              key: '5eb393ee95fab7468a79d189/ADMIN/sample.pdf',
            },
          ],
        },
      ],
      exerciseIds: [
        {
          _id: `ex_${batchId}_2`,
          topic: 'DPP 02 Quiz',
          name: 'DPP 02 Quiz',
          totalQuestions: 10,
        },
      ],
    },
    {
      _id: `lec_${batchId}_${subjectId}_${tagId}_3`,
      topic: 'Lecture 03 : Numerical Illustrations & Advanced Problem Solving',
      name: 'Lecture 03 : Numerical Illustrations & Advanced Problem Solving',
      type: 'LECTURES',
      date: new Date(Date.now() - 2 * 86400000).toISOString(),
      videoId: `vid_${batchId}_3`,
      videoDetails: {
        duration: '01:28:40',
        videoUrl: 'https://www.youtube.com/watch?v=dQw4w9WgXcQ',
      },
      urlType: 'youtube',
      teacherDetails: {
        name: 'Faculty PW',
      },
      homeworkIds: [
        {
          _id: `hw_${batchId}_3`,
          topic: 'Lecture 03 Class Notes',
          name: 'Lecture 03 Class Notes',
          attachmentIds: [
            {
              name: 'Lecture_03_Notes.pdf',
              baseUrl: 'https://static.pw.live/',
              key: '5eb393ee95fab7468a79d189/ADMIN/sample.pdf',
            },
          ],
        },
      ],
      exerciseIds: [
        {
          _id: `ex_${batchId}_3`,
          topic: 'DPP 03 Quiz',
          name: 'DPP 03 Quiz',
          totalQuestions: 10,
        },
      ],
    },
    {
      _id: `lec_${batchId}_${subjectId}_${tagId}_4`,
      topic: 'Lecture 04 : High-Yield PYQs & Chapter Summary',
      name: 'Lecture 04 : High-Yield PYQs & Chapter Summary',
      type: 'LECTURES',
      date: new Date(Date.now() - 1 * 86400000).toISOString(),
      videoId: `vid_${batchId}_4`,
      videoDetails: {
        duration: '01:18:20',
        videoUrl: 'https://www.youtube.com/watch?v=dQw4w9WgXcQ',
      },
      urlType: 'youtube',
      teacherDetails: {
        name: 'Faculty PW',
      },
      homeworkIds: [
        {
          _id: `hw_${batchId}_4`,
          topic: 'Lecture 04 Class Notes',
          name: 'Lecture 04 Class Notes',
          attachmentIds: [
            {
              name: 'Lecture_04_Notes.pdf',
              baseUrl: 'https://static.pw.live/',
              key: '5eb393ee95fab7468a79d189/ADMIN/sample.pdf',
            },
          ],
        },
      ],
      exerciseIds: [
        {
          _id: `ex_${batchId}_4`,
          topic: 'DPP 04 Quiz',
          name: 'DPP 04 Quiz',
          totalQuestions: 10,
        },
      ],
    },
  ];
}

// 2. Penpencil API proxy with fallback for batch details and topic lists
app.all(['/api/penpencil', '/api/penpencil/*'], async (req, res) => {
  const sub = req.path.replace(/^\/api\/penpencil/, '') || '/';
  const cleanSub = sub.startsWith('/') ? sub : `/${sub}`;

  // Handle batch details: /batches/details/:batchId
  const batchDetailsMatch = cleanSub.match(/^\/batches\/details\/([a-zA-Z0-9_-]+)/);
  if (batchDetailsMatch) {
    const batchId = batchDetailsMatch[1];
    try {
      const headers: Record<string, string> = {
        'Origin': 'https://pw.eduvibe.cc.cd',
        'Referer': 'https://pw.eduvibe.cc.cd/',
        'User-Agent': (req.headers['user-agent'] as string) || 'Mozilla/5.0',
        'Accept': 'application/json',
        'x-platform': 'PW',
      };
      for (const h of ['x-request-signature', 'x-request-timestamp', 'x-puzzle-nonce', 'x-xsrf-token', 'x-status-ticket']) {
        if (req.headers[h]) headers[h] = req.headers[h] as string;
      }

      const upstreamRes = await fetch(`https://api.penpencil.cc.cd${cleanSub}`, {
        method: req.method,
        headers,
      });

      if (upstreamRes.ok) {
        const data = await upstreamRes.json();
        return res.json(data);
      }
    } catch (err: any) {
      console.warn(`Upstream batch details failed for ${batchId}:`, err.message);
    }

    // Upstream returned 401 or failed: serve rich batch details
    const meta = await getBatchFromList(batchId);
    const details = getBatchDetailsPayload(batchId, meta);
    return res.json({
      success: true,
      data: details,
    });
  }

  // Handle topic list: /topic/list/:batchId/:subjectId
  const topicListMatch = cleanSub.match(/^\/topic\/list\/([a-zA-Z0-9_-]+)\/([a-zA-Z0-9_-]+)/);
  if (topicListMatch) {
    const batchId = topicListMatch[1];
    const subjectId = topicListMatch[2];
    try {
      const headers: Record<string, string> = {
        'Origin': 'https://pw.eduvibe.cc.cd',
        'Referer': 'https://pw.eduvibe.cc.cd/',
        'User-Agent': (req.headers['user-agent'] as string) || 'Mozilla/5.0',
        'Accept': 'application/json',
        'x-platform': 'PW',
      };
      for (const h of ['x-request-signature', 'x-request-timestamp', 'x-puzzle-nonce', 'x-xsrf-token', 'x-status-ticket']) {
        if (req.headers[h]) headers[h] = req.headers[h] as string;
      }

      const upstreamRes = await fetch(`https://api.penpencil.cc.cd${cleanSub}`, {
        method: req.method,
        headers,
      });

      if (upstreamRes.ok) {
        const data = await upstreamRes.json();
        return res.json(data);
      }
    } catch (err: any) {
      console.warn(`Upstream topic list failed for ${batchId}/${subjectId}:`, err.message);
    }

    // Fallback chapters
    const chapters = [
      {
        _id: `top_${batchId}_${subjectId}_1`,
        topicId: `top_${batchId}_${subjectId}_1`,
        name: 'Chapter 01 : Fundamentals & Prerequisites',
        topic: 'Chapter 01 : Fundamentals & Prerequisites',
        type: 'CHAPTER',
        totalLectures: 8,
        totalDpp: 8,
        completedLecture: 0,
        completedDpp: 0,
      },
      {
        _id: `top_${batchId}_${subjectId}_2`,
        topicId: `top_${batchId}_${subjectId}_2`,
        name: 'Chapter 02 : Core Concepts & Theory Applications',
        topic: 'Chapter 02 : Core Concepts & Theory Applications',
        type: 'CHAPTER',
        totalLectures: 12,
        totalDpp: 12,
        completedLecture: 0,
        completedDpp: 0,
      },
      {
        _id: `top_${batchId}_${subjectId}_3`,
        topicId: `top_${batchId}_${subjectId}_3`,
        name: 'Chapter 03 : Problem Solving & Numerical Practice',
        topic: 'Chapter 03 : Problem Solving & Numerical Practice',
        type: 'CHAPTER',
        totalLectures: 10,
        totalDpp: 10,
        completedLecture: 0,
        completedDpp: 0,
      },
      {
        _id: `top_${batchId}_${subjectId}_4`,
        topicId: `top_${batchId}_${subjectId}_4`,
        name: 'Chapter 04 : High-Yield Revision & PYQs',
        topic: 'Chapter 04 : High-Yield Revision & PYQs',
        type: 'CHAPTER',
        totalLectures: 6,
        totalDpp: 6,
        completedLecture: 0,
        completedDpp: 0,
      },
    ];

    return res.json({
      success: true,
      data: chapters,
      topics: chapters,
      paginate: {
        total: chapters.length,
        page: 1,
        limit: 20,
      },
    });
  }

  // Handle content list: /content/list/:batchId/:subjectId
  const contentListMatch = cleanSub.match(/^\/content\/list\/([a-zA-Z0-9_-]+)\/([a-zA-Z0-9_-]+)/);
  if (contentListMatch) {
    const batchId = contentListMatch[1];
    const subjectId = contentListMatch[2];
    const queryIdx = req.url.indexOf('?');
    const queryStr = queryIdx !== -1 ? req.url.slice(queryIdx) : '';
    const contentType = (req.query.contentType as string) || 'LECTURES';
    const tagId = (req.query.tagId as string) || 'top_1';

    try {
      const headers: Record<string, string> = {
        'Origin': 'https://pw.eduvibe.cc.cd',
        'Referer': 'https://pw.eduvibe.cc.cd/',
        'User-Agent': (req.headers['user-agent'] as string) || 'Mozilla/5.0',
        'Accept': 'application/json',
        'x-platform': 'PW',
      };
      for (const h of ['x-request-signature', 'x-request-timestamp', 'x-puzzle-nonce', 'x-xsrf-token', 'x-status-ticket']) {
        if (req.headers[h]) headers[h] = req.headers[h] as string;
      }

      const upstreamRes = await fetch(`https://api.penpencil.cc.cd${cleanSub}${queryStr}`, {
        method: req.method,
        headers,
      });

      if (upstreamRes.ok) {
        const data = await upstreamRes.json();
        return res.json(data);
      }
    } catch (err: any) {
      console.warn(`Upstream content list failed for ${batchId}/${subjectId}:`, err.message);
    }

    // Upstream returned 401 or failed: serve fallback content
    const items = generateContentList(batchId, subjectId, contentType, tagId);
    return res.json({
      success: true,
      data: items,
      paginate: {
        total: items.length,
        page: 1,
        limit: 20,
      },
    });
  }

  // Handle DPP quizzes: /content/dpp-list
  if (cleanSub.startsWith('/content/dpp-list')) {
    const queryIdx = req.url.indexOf('?');
    const queryStr = queryIdx !== -1 ? req.url.slice(queryIdx) : '';
    const batchId = (req.query.batchId as string) || 'batch_1';
    const chapterId = (req.query.chapterId as string) || 'chap_1';

    try {
      const headers: Record<string, string> = {
        'Origin': 'https://pw.eduvibe.cc.cd',
        'Referer': 'https://pw.eduvibe.cc.cd/',
        'User-Agent': (req.headers['user-agent'] as string) || 'Mozilla/5.0',
        'Accept': 'application/json',
        'x-platform': 'PW',
      };
      for (const h of ['x-request-signature', 'x-request-timestamp', 'x-puzzle-nonce', 'x-xsrf-token', 'x-status-ticket']) {
        if (req.headers[h]) headers[h] = req.headers[h] as string;
      }

      const upstreamRes = await fetch(`https://api.penpencil.cc.cd${cleanSub}${queryStr}`, {
        method: req.method,
        headers,
      });

      if (upstreamRes.ok) {
        const data = await upstreamRes.json();
        return res.json(data);
      }
    } catch (err: any) {
      console.warn('Upstream dpp-list failed:', err.message);
    }

    const quizzes = [1, 2, 3, 4].map(num => ({
      _id: `dpp_quiz_${batchId}_${chapterId}_${num}`,
      topic: `DPP 0${num} Interactive Quiz`,
      name: `DPP 0${num} Interactive Quiz`,
      totalQuestions: 10,
      duration: 30,
      status: 'ACTIVE',
    }));

    return res.json({
      success: true,
      data: quizzes,
      paginate: {
        total: quizzes.length,
        page: 1,
        limit: 20,
      },
    });
  }

  // Handle schedule details: /content/schedule-details/:batchId/:subjectId/:scheduleId
  const scheduleDetailsMatch = cleanSub.match(/^\/content\/schedule-details\/([a-zA-Z0-9_-]+)\/([a-zA-Z0-9_-]+)\/([a-zA-Z0-9_-]+)/);
  if (scheduleDetailsMatch) {
    const batchId = scheduleDetailsMatch[1];
    const subjectId = scheduleDetailsMatch[2];
    const scheduleId = scheduleDetailsMatch[3];
    return res.json({
      success: true,
      data: {
        _id: scheduleId,
        batchId,
        subjectId,
        topic: 'Lecture Details',
        homeworkIds: [
          {
            _id: `hw_${scheduleId}`,
            topic: 'Class Notes',
            attachmentIds: [
              {
                name: 'Notes.pdf',
                baseUrl: 'https://static.pw.live/',
                key: '5eb393ee95fab7468a79d189/ADMIN/sample.pdf',
              },
            ],
          },
        ],
        exerciseIds: [
          {
            _id: `ex_${scheduleId}`,
            topic: 'DPP Quiz',
            totalQuestions: 10,
          },
        ],
        videoDetails: {
          duration: '01:20:00',
          videoUrl: 'https://www.youtube.com/watch?v=dQw4w9WgXcQ',
        },
      },
    });
  }

  // Proxy remaining penpencil endpoints
  proxyTo('https://api.penpencil.cc.cd', cleanSub, req, res);
});

// Helper to create valid JWT tokens compatible with client-side decoder
function createJwtToken(userData: any): string {
  const header = Buffer.from(JSON.stringify({ alg: 'HS256', typ: 'JWT' })).toString('base64url');
  const payload = Buffer.from(JSON.stringify(userData)).toString('base64url');
  const signature = Buffer.from('pw_eduvibe_local_signature').toString('base64url');
  return `${header}.${payload}.${signature}`;
}

const defaultStudent = {
  id: 1,
  userId: 1,
  email: 'student@pw.eduvibe',
  full_name: 'PW Student',
  batchId: [],
  role: 'student',
  iat: Math.floor(Date.now() / 1000),
  exp: Math.floor(Date.now() / 1000) + 365 * 24 * 3600
};

// 3. Auth API
app.all(['/api/auth', '/api/auth/*'], async (req, res) => {
  const sub = req.path.replace(/^\/api\/auth/, '') || '/';
  const cleanSub = sub.startsWith('/') ? sub : `/${sub}`;

  let parsedBody: any = {};
  if (req.body && Buffer.isBuffer(req.body) && (req.body as Buffer).length > 0) {
    try {
      parsedBody = JSON.parse((req.body as Buffer).toString('utf-8'));
    } catch {}
  }

  // A. Bypass Login
  if (cleanSub === '/bypass' && req.method === 'POST') {
    const studentUser = {
      ...defaultStudent,
      iat: Math.floor(Date.now() / 1000),
      exp: Math.floor(Date.now() / 1000) + 365 * 24 * 3600
    };
    const token = createJwtToken(studentUser);
    const refreshToken = createJwtToken({
      ...studentUser,
      type: 'refresh',
      exp: Math.floor(Date.now() / 1000) + 730 * 24 * 3600
    });

    return res.json({
      success: true,
      token,
      'Auth Token': token,
      refreshToken,
      'Auth Refresh Token': refreshToken,
      user: {
        id: 1,
        email: 'student@pw.eduvibe',
        full_name: 'PW Student',
        batchId: [],
        role: 'student',
        streak: { streak: 7, xp: 1250 },
        xp: 1250,
        total_xp: 1250
      }
    });
  }

  // B. Google Login
  if (cleanSub === '/google' && req.method === 'POST') {
    let name = 'PW Student';
    let email = 'student@pw.eduvibe';
    if (parsedBody.idToken && typeof parsedBody.idToken === 'string' && parsedBody.idToken.includes('.')) {
      try {
        const parts = parsedBody.idToken.split('.');
        const payload = JSON.parse(Buffer.from(parts[1], 'base64url').toString('utf-8'));
        if (payload.name) name = payload.name;
        if (payload.email) email = payload.email;
      } catch {}
    }
    const studentUser = {
      id: 1,
      userId: 1,
      email,
      full_name: name,
      batchId: [],
      role: 'student',
      iat: Math.floor(Date.now() / 1000),
      exp: Math.floor(Date.now() / 1000) + 365 * 24 * 3600
    };
    const token = createJwtToken(studentUser);
    const refreshToken = createJwtToken({
      ...studentUser,
      type: 'refresh',
      exp: Math.floor(Date.now() / 1000) + 730 * 24 * 3600
    });

    return res.json({
      success: true,
      token,
      'Auth Token': token,
      refreshToken,
      'Auth Refresh Token': refreshToken,
      user: {
        id: 1,
        email,
        full_name: name,
        batchId: [],
        role: 'student',
        streak: { streak: 7, xp: 1250 },
        xp: 1250,
        total_xp: 1250
      }
    });
  }

  // C. Profile endpoint /me
  if (cleanSub === '/me' && req.method === 'GET') {
    const authHeader = req.headers['authorization'];
    if (!authHeader) {
      return res.status(401).json({ error: 'No token provided, authorization denied' });
    }
    let name = 'PW Student';
    let email = 'student@pw.eduvibe';
    if (typeof authHeader === 'string' && authHeader.startsWith('Bearer ')) {
      const rawToken = authHeader.slice(7).trim();
      try {
        const parts = rawToken.split('.');
        if (parts.length === 3) {
          const payload = JSON.parse(Buffer.from(parts[1], 'base64url').toString('utf-8'));
          if (payload.full_name) name = payload.full_name;
          if (payload.email) email = payload.email;
        }
      } catch {}
    }
    return res.json({
      id: 1,
      email,
      full_name: name,
      batchId: [],
      role: 'student',
      streak: { streak: 7, xp: 1250 },
      xp: 1250,
      total_xp: 1250
    });
  }

  // D. Enrolled batches /batches
  if (cleanSub === '/batches' && req.method === 'GET') {
    return res.json({
      batches: [],
      batchId: []
    });
  }

  // E. Refresh token /refresh
  if (cleanSub === '/refresh' && req.method === 'POST') {
    const studentUser = {
      ...defaultStudent,
      iat: Math.floor(Date.now() / 1000),
      exp: Math.floor(Date.now() / 1000) + 365 * 24 * 3600
    };
    const token = createJwtToken(studentUser);
    const refreshToken = createJwtToken({
      ...studentUser,
      type: 'refresh',
      exp: Math.floor(Date.now() / 1000) + 730 * 24 * 3600
    });
    return res.json({
      success: true,
      token,
      'Auth Token': token,
      refreshToken,
      'Auth Refresh Token': refreshToken
    });
  }

  // F. Logout
  if (cleanSub === '/logout' && req.method === 'POST') {
    return res.json({ success: true });
  }

  // G. Users count /count
  if (cleanSub === '/count' && req.method === 'GET') {
    try {
      const countRes = await fetch('https://auth.eduvibe.cc.cd/count', {
        headers: {
          'Origin': 'https://pw.eduvibe.cc.cd',
          'Referer': 'https://pw.eduvibe.cc.cd/'
        }
      });
      if (countRes.ok) {
        const data = await countRes.json();
        return res.json(data);
      }
    } catch {}
    return res.json({ total: 1296 });
  }

  // Fallback upstream proxy
  proxyTo('https://auth.eduvibe.cc.cd', cleanSub, req, res);
});

// 4. Progress API proxy with graceful fallback
app.all(['/api/progress', '/api/progress/*'], async (req, res) => {
  const sub = req.path.replace(/^\/api\/progress/, '') || '/';
  try {
    const upstreamRes = await fetch(`https://progress.eduvibe.cc.cd${sub.startsWith('/') ? sub : `/${sub}`}`, {
      method: req.method,
      headers: {
        'Origin': 'https://pw.eduvibe.cc.cd',
        'Referer': 'https://pw.eduvibe.cc.cd/',
        'x-platform': 'PW',
        'Content-Type': 'application/json',
        ...(req.headers['authorization'] ? { 'authorization': req.headers['authorization'] as string } : {})
      }
    });
    if (upstreamRes.ok) {
      const data = await upstreamRes.json();
      return res.json(data);
    }
  } catch {}
  res.json({ topics: [], data: [] });
});

// 5. Mount static assets or Vite development middlewares
async function startServer() {
  if (process.env.NODE_ENV === 'production') {
    app.use(express.static(path.resolve(__dirname, 'dist')));
    app.use(express.static(path.resolve(__dirname, 'public')));
    app.get('*', (_req, res) => {
      res.sendFile(path.resolve(__dirname, 'dist/index.html'));
    });
  } else {
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: 'spa',
    });
    app.use(vite.middlewares);
  }

  app.listen(Number(PORT), '0.0.0.0', () => {
    console.log(`EduVibe mirror server running on http://0.0.0.0:${PORT}`);
  });
}

startServer();
