/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useState, useRef, useEffect } from 'react';
import * as XLSX from 'xlsx';
import html2canvas from 'html2canvas';
import { jsPDF } from 'jspdf';
import { 
  FileUp, 
  Search, 
  AlertTriangle, 
  Trophy, 
  Download, 
  Printer, 
  X, 
  ChevronDown, 
  TrendingUp,
  LayoutDashboard,
  CheckCircle2,
  BrainCircuit,
  FileSpreadsheet,
  ChevronRight,
  User,
  Sparkles,
  ScrollText,
  Copy,
  RefreshCw,
  Star,
  GraduationCap,
  UserMinus,
  Target,
  Zap,
  Info,
  MessageSquareWarning,
  Send
} from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';
import { Student, CompetencyStats, TeacherInfo, ISA2Stats } from './types';
import { GoogleGenAI } from "@google/genai";
import { 
  BarChart, 
  Bar, 
  XAxis, 
  YAxis, 
  Tooltip, 
  ResponsiveContainer, 
  Cell,
  Radar,
  RadarChart,
  PolarGrid,
  PolarAngleAxis,
  PolarRadiusAxis
} from 'recharts';
import { db, handleFirestoreError, OperationType } from './lib/firebase';
import { collection, addDoc, serverTimestamp } from 'firebase/firestore';

// Lazy initialize Gemini to avoid crashing if API key is missing at startup
let genAI: GoogleGenAI | null = null;
const getGenAI = () => {
  if (!genAI) {
    const apiKey = process.env.GEMINI_API_KEY;
    if (!apiKey) {
      console.error("GEMINI_API_KEY is missing. AI features will not work.");
      return null;
    }
    genAI = new GoogleGenAI({ apiKey });
  }
  return genAI;
};

// Utility for Excel column letters to indices
const colToIdx = (c: string) => {
  let i = 0;
  for (let x = 0; x < c.length; x++) i = i * 26 + c.charCodeAt(x) - 64;
  return i - 1;
};

export default function App() {
  const [excelData, setExcelData] = useState<any[][] | null>(null);
  const [prevIsaValue, setPrevIsaValue] = useState<string>('');
  const [teacherInfo, setTeacherInfo] = useState<TeacherInfo | null>(null);
  const [compStats, setCompStats] = useState<CompetencyStats[]>([]);
  const [isaStats, setIsaStats] = useState<ISA2Stats | null>(null);
  const [classAverages, setClassAverages] = useState<Record<string, number>>({});
  const [eliteStudents, setEliteStudents] = useState<Student[]>([]);
  const [allStudents, setAllStudents] = useState<Student[]>([]);
  const [activeModal, setActiveModal] = useState<'comp' | 'struggle' | 'honor' | 'ai' | 'students' | null>(null);
  const [filterLevel, setFilterLevel] = useState<'A' | 'B' | 'C' | 'D' | 'All'>('All');
  const [downloadStatus, setDownloadStatus] = useState<string>('');
  const [loading, setLoading] = useState(false);
  const [openAccordion, setOpenAccordion] = useState<string | null>(null);
  const [searchTerm, setSearchTerm] = useState('');
  const [aiReport, setAiReport] = useState<string>('');
  const [isGeneratingAi, setIsGeneratingAi] = useState(false);
  const [showWelcome, setShowWelcome] = useState(false);
  const [bugMessage, setBugMessage] = useState('');
  const [bugReportStatus, setBugReportStatus] = useState<'idle' | 'sending' | 'success'>('idle');

  useEffect(() => {
    const hasSeenWelcome = localStorage.getItem('isa2_welcome_seen');
    if (!hasSeenWelcome) {
      setShowWelcome(true);
    }
  }, []);

  const closeWelcome = () => {
    setShowWelcome(false);
    localStorage.setItem('isa2_welcome_seen', 'true');
  };

  const submitBugReport = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!bugMessage.trim()) return;
    
    setBugReportStatus('sending');
    const path = 'bugReports';

    try {
      await addDoc(collection(db, path), {
        message: bugMessage,
        createdAt: serverTimestamp(),
        userAgent: window.navigator.userAgent,
      });
      setBugReportStatus('success');
      setBugMessage('');
      setTimeout(() => setBugReportStatus('idle'), 3000);
    } catch (err) {
      console.error('Submission error:', err);
      try {
        handleFirestoreError(err, OperationType.WRITE, path);
      } catch (finalErr) {
        alert('حدث خطأ أثناء إرسال البلاغ. يرجى المحاولة لاحقاً.');
      }
      setBugReportStatus('idle');
    }
  };

  const fileInputRef = useRef<HTMLInputElement>(null);
  const reportAreaRef = useRef<HTMLDivElement>(null);
  const parentReportRef = useRef<HTMLDivElement>(null);

  const handleFileUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    const reader = new FileReader();
    reader.onload = (event) => {
      const data = new Uint8Array(event.target.result as ArrayBuffer);
      const wb = XLSX.read(data, { type: 'array' });
      const sheet = wb.Sheets[wb.SheetNames[0]];
      const json = XLSX.utils.sheet_to_json(sheet, { header: 1 }) as any[][];
      setExcelData(json);
    };
    reader.readAsArrayBuffer(file);
  };

  const processData = () => {
    if (!excelData) return;
    setLoading(true);

    try {
      // Extracted from original script logic
      const subject = String(excelData[3]?.[colToIdx('O')] || "المادة");
      const level = String(excelData[3]?.[colToIdx('C')] || "-");
      const cls = String(excelData[3]?.[colToIdx('H')] || "-");
      const stage = String(excelData[4]?.[colToIdx('C')] || "-");

      setTeacherInfo({ subject, level, className: cls, stage });

      const nameRowIdx = 10, startCol = 4, codeCol = 2;
      const students: Student[] = [];
      
      // Identify students from header row
      excelData[nameRowIdx]?.forEach((name, idx) => {
        if (idx >= startCol && name && String(name).trim() !== "") {
          students.push({ idx, name: String(name), isElite: true });
        }
      });

      const stats: CompetencyStats[] = [];
      const studentMetrics = students.map((s) => ({ ...s, sum: 0, count: 0, scores: [] as { code: string, value: number }[] }));

      for (let r = 11; r < excelData.length; r++) {
        const code = String(excelData[r]?.[codeCol] || "").trim();
        if (!code || code === "الرمز") continue;

        const cats: { A: string[], B: string[], C: string[], D: string[] } = { A: [], B: [], C: [], D: [] };
        
        students.forEach((st, sIdx) => {
          const val = parseFloat(excelData[r][st.idx]);
          if (!isNaN(val)) {
            studentMetrics[sIdx].sum += val;
            studentMetrics[sIdx].count++;
            studentMetrics[sIdx].scores.push({ code, value: val });
            
            // For honors: a student is elite if all their scores are >= 8
            if (val < 8) {
              studentMetrics[sIdx].isElite = false;
            }
            
            const entry = `${st.name} (${val.toFixed(1)})`;
            if (val >= 8) cats.A.push(entry);
            else if (val >= 6) cats.B.push(entry);
            else if (val >= 4) cats.C.push(entry);
            else cats.D.push(entry);
          }
        });

        stats.push({ code, ...cats });
      }

      // Calculate Class Averages per competency
      const averages: Record<string, number> = {};
      stats.forEach(c => {
        const total = c.A.length + c.B.length + c.C.length + c.D.length;
        if (total > 0) {
          // Average weight based on distribution
          averages[c.code] = ((c.A.length * 9) + (c.B.length * 7) + (c.C.length * 5) + (c.D.length * 3)) / total;
        }
      });
      setClassAverages(averages);

      const finalStudents: Student[] = studentMetrics.map(m => {
        const avg = m.count > 0 ? m.sum / m.count : 0;
        let level: 'A' | 'B' | 'C' | 'D' = 'D';
        if (avg >= 8) level = 'A';
        else if (avg >= 6) level = 'B';
        else if (avg >= 4) level = 'C';

        return {
          idx: m.idx,
          name: m.name,
          isElite: m.isElite,
          average: avg,
          level: level,
          scores: m.scores
        };
      });

      setCompStats(stats);
      setAllStudents(finalStudents.sort((a, b) => (b.average || 0) - (a.average || 0)));
      setEliteStudents(finalStudents.filter(s => s.isElite));

      // Global Stats calculation
      const fCats = { A: 0, B: 0, C: 0, D: 0 };
      let total = 0;
      
      finalStudents.forEach(s => {
        if (s.average !== undefined) {
          total++;
          if (s.level === 'A') fCats.A++;
          else if (s.level === 'B') fCats.B++;
          else if (s.level === 'C') fCats.C++;
          else fCats.D++;
        }
      });

      const pA = total > 0 ? (fCats.A / total) * 100 : 0;
      const pB = total > 0 ? (fCats.B / total) * 100 : 0;
      const pC = total > 0 ? (fCats.C / total) * 100 : 0;
      const pD = total > 0 ? (fCats.D / total) * 100 : 0;
      
      const isaValue = (0.8 * ((3 * pA + 2 * pB + 1 * pC) / 3)).toFixed(2);

      setIsaStats({ isaValue, pA, pB, pC, pD, totalStudents: total });
    } catch (err) {
      console.error(err);
      alert("حدث خطأ أثناء معالجة البيانات. يرجى التأكد من توافق تنسيق الملف.");
    } finally {
      setLoading(false);
    }
  };

  const downloadStruggleReport = async () => {
    if (!reportAreaRef.current) return;
    setDownloadStatus('جاري معالجة التقرير الرسمي...');
    try {
      const element = reportAreaRef.current;
      const canvas = await html2canvas(element, { 
        scale: 3, // High quality
        useCORS: true,
        logging: false,
        backgroundColor: '#ffffff',
      });
      
      const imgData = canvas.toDataURL('image/png');
      const pdf = new jsPDF({
        orientation: 'p',
        unit: 'mm',
        format: 'a4'
      });
      
      const imgWidth = 210; // A4 Width in mm
      const imgHeight = (canvas.height * imgWidth) / canvas.width;
      
      pdf.addImage(imgData, 'PNG', 0, 0, imgWidth, imgHeight);
      pdf.save(`تقرير_الدعم_${teacherInfo?.className || 'عام'}.pdf`);
    } catch (err) {
      console.error('PDF Error:', err);
      alert('حدث خطأ أثناء إنشاء التقرير.');
    } finally {
      setDownloadStatus('');
    }
  };

  const [selectedStudentDetails, setSelectedStudentDetails] = useState<Student | null>(null);
  const [parentReport, setParentReport] = useState<string>('');
  const [isGeneratingParentReport, setIsGeneratingParentReport] = useState(false);

  const getStudentPerformance = (student: Student | null) => {
    if (!student || !student.scores) return [];
    
    return student.scores.map(s => {
      let label = 'D';
      if (s.value >= 8) label = 'A';
      else if (s.value >= 6) label = 'B';
      else if (s.value >= 4) label = 'C';
      
      return {
        subject: s.code,
        score: s.value * 10,
        classAvg: (classAverages[s.code] || 0) * 10,
        val: s.value,
        label: label
      };
    });
  };

  const [studentStrategy, setStudentStrategy] = useState<string>('');
  const [isGeneratingStrategy, setIsGeneratingStrategy] = useState(false);

  const generateStudentStrategy = async (student: Student) => {
    const aiClient = getGenAI();
    if (!aiClient) {
      alert("يرجى إعداد مفتاح GEMINI_API_KEY في إعدادات البيئة لتفعيل تحليل الذكاء الاصطناعي.");
      return;
    }
    
    setIsGeneratingStrategy(true);
    setStudentStrategy('');
    try {
      const perf = getStudentPerformance(student);
      const weakPoints = perf.filter(p => p.val < 5).map(p => p.subject).join('، ');
      const strongPoints = perf.filter(p => p.val >= 8).map(p => p.subject).join('، ');

      const model = aiClient.getGenerativeModel({ model: "gemini-1.5-flash" });
      const prompt = `أنت خبير في البيداغوجيا الفارقية. قم بوضع خطة دعم قصيرة جداً (3 نقاط) لهذا التلميذ: ${student.name}.
            قوي في: ${strongPoints || 'لا يوجد حالياً'}.
            يعاني في: ${weakPoints || 'لا يوجد حالياً'}.
            المادة: ${teacherInfo?.subject}.
            اكتبها بأسلوب مهني مقتضب ومباشر للأستاذ. استخدم الرموز 💡🌱.`;

      const result = await model.generateContent(prompt);
      const response = await result.response;
      setStudentStrategy(response.text() || 'لا توجد توصيات حالياً.');
    } catch (err) {
      console.error('Strategy Error:', err);
    } finally {
      setIsGeneratingStrategy(false);
    }
  };

  const generateParentReport = async (student: Student) => {
    const aiClient = getGenAI();
    if (!aiClient) {
      alert("يرجى إعداد مفتاح GEMINI_API_KEY في إعدادات البيئة لتفعيل تحليل الذكاء الاصطناعي.");
      return;
    }

    setIsGeneratingParentReport(true);
    setParentReport('');
    try {
      const perf = getStudentPerformance(student);
      const perfSummary = perf.map(p => `${p.subject}: مستوى ${p.label}`).join('، ');

      const model = aiClient.getGenerativeModel({ model: "gemini-1.5-flash" });
      const prompt = `أنت مستشار تربوي متميز. قم بكتابة رسالة رسمية "تقرير ولي الأمر" باللغة العربية الفصحى الراقية.
            المرسل: أستاذ مادة ${teacherInfo?.subject}.
            التلميذ(ة): ${student.name}.
            النتائج: ${perfSummary}.
            الهدف: تقديم تحليل تربوي رصين لولي الأمر، موضحاً نقاط القوة بلباقة، ومقترحاً سبل التطوير للمهارات التي تحتاج دعماً.
            التنسيق: خطاب رسمي محترم يبدأ بـ "ولي الأمر الفاضل" وينتهي بتوقيع "أستاذ المادة".
            استخدم الرموز التعبيرية بحكمة وهدوء 🖋️📖.`;

      const result = await model.generateContent(prompt);
      const response = await result.response;
      setParentReport(response.text() || 'عذراً، تعذر صياغة التقرير للآباء حالياً.');
    } catch (err) {
      console.error('Parent Report Error:', err);
      setParentReport('عذراً، تعذر صياغة التقرير للآباء حالياً.');
    } finally {
      setIsGeneratingParentReport(false);
    }
  };

  const downloadParentReportPDF = async () => {
    if (!parentReportRef.current || !selectedStudentDetails) return;
    
    setDownloadStatus(`جاري معالجة وثيقة ولي الأمر...`);
    try {
      const element = parentReportRef.current;
      const canvas = await html2canvas(element, { 
        scale: 3,
        useCORS: true,
        logging: false,
        backgroundColor: '#ffffff',
      });
      
      const imgData = canvas.toDataURL('image/png');
      const pdf = new jsPDF({
        orientation: 'p',
        unit: 'mm',
        format: 'a4'
      });
      
      const imgWidth = 210;
      const imgHeight = (canvas.height * imgWidth) / canvas.width;
      
      pdf.addImage(imgData, 'PNG', 0, 0, imgWidth, imgHeight);
      pdf.save(`تقرير_ولي_الأمر_${selectedStudentDetails.name}.pdf`);
    } catch (err) {
      console.error('Parent Report PDF Error:', err);
      alert('حدث خطأ أثناء إنشاء التقرير.');
    } finally {
      setDownloadStatus('');
    }
  };

  const generateSingleCertificate = async (st: Student) => {
    setDownloadStatus(`جاري تجهيز شهادة ${st.name}...`);
    const container = document.createElement('div');
    container.style.position = 'absolute';
    container.style.left = '-9999px';
    container.style.top = '0';
    container.style.width = '1123px'; // A4 Landscape
    document.body.appendChild(container);

    const certHtml = `
      <div style="width: 1123px; height: 794px; padding: 40px; background: #ffffff; direction: rtl; font-family: 'Cairo', sans-serif; box-sizing: border-box; position: relative; border: 30px solid transparent; border-image: linear-gradient(135deg, #8a6d3b 0%, #d4af37 25%, #8a6d3b 50%, #d4af37 75%, #8a6d3b 100%) 30;">
        <div style="height: 100%; border: 2px solid #8a6d3b; padding: 30px; position: relative; background: #fffaf0; box-shadow: inset 0 0 80px rgba(138, 109, 59, 0.05);">
          
          <!-- Ornaments -->
          <div style="position: absolute; top: 0; left: 0; width: 100px; height: 100px; border-top: 10px solid #8a6d3b; border-left: 10px solid #8a6d3b;"></div>
          <div style="position: absolute; bottom: 0; right: 0; width: 100px; height: 100px; border-bottom: 10px solid #8a6d3b; border-right: 10px solid #8a6d3b;"></div>
          
          <div style="text-align: center; margin-bottom: 20px;">
            <p style="font-size: 20px; font-weight: 900; color: #8a6d3b; margin: 0;">المملكة المغربية</p>
            <p style="font-size: 14px; font-weight: 700; color: #af8d4b; margin: 5px 0;">وزارة التربية الوطنية والتعليم الأولي والرياضة</p>
            <div style="width: 100px; height: 2px; background: #d4af37; margin: 10px auto;"></div>
          </div>

          <h1 style="font-size: 80px; color: #1e293b; font-weight: 950; margin: 20px 0; text-shadow: 2px 2px 0px rgba(0,0,0,0.05);">شهادة تميز</h1>
          
          <p style="font-size: 32px; color: #475569; font-weight: 700; margin-top: 40px;">يتشرف طاقم نظام ISA2 التربوي بتقديم هذه الشهادة للتلميذ(ة):</p>
          
          <div style="margin: 30px 0; position: relative; display: inline-block;">
             <div style="font-size: 72px; color: #064e3b; font-weight: 950; padding: 0 40px; position: relative; z-index: 1;">${st.name}</div>
             <div style="position: absolute; bottom: 10px; left: 0; width: 100%; height: 20px; background: rgba(138, 109, 59, 0.15); border-radius: 20px;"></div>
          </div>

          <p style="font-size: 26px; color: #475569; font-weight: 700; margin-top: 20px; line-height: 1.6;">بمناسبة تفوقه الباهر في مادة <span style="color: #0d9488;">${teacherInfo?.subject}</span> بالقسم <span style="color: #0d9488;">${teacherInfo?.className}</span><br/>وتحقيقه لأعلى معدلات المؤشرات التربوية لهذا الموسم.</p>
          
          <div style="margin-top: 60px; display: flex; justify-content: space-around; align-items: center; padding: 0 20px;">
            <div style="text-align: center;">
              <p style="font-size: 16px; font-weight: 900; color: #1e293b; margin-bottom: 50px;">السيد المدير</p>
              <div style="width: 150px; border-bottom: 1px dashed #8a6d3b;"></div>
            </div>
            
            <div style="position: relative;">
               <div style="width: 150px; height: 150px; border: 6px double #d4af37; border-radius: 50%; display: flex; flex-direction: column; align-items: center; justify-content: center; transform: rotate(-15deg); color: #8a6d3b; background: rgba(254, 252, 232, 0.5);">
                  <div style="font-size: 12px; font-weight: 900;">نظام ISA2</div>
                  <div style="font-size: 40px; font-weight: 950;">ختم</div>
                  <div style="font-size: 12px; font-weight: 900;">الجودة</div>
               </div>
            </div>

            <div style="text-align: center;">
              <p style="font-size: 14px; color: #8a6d3b; font-weight: 900; margin-bottom: 5px;">حرر بـ: ${teacherInfo?.className}</p>
              <p style="font-size: 14px; font-weight: 800; color: #334155; margin-bottom: 40px;">بتاريخ: ${new Date().toLocaleDateString('ar-MA')}</p>
              <div style="width: 150px; border-bottom: 1px dashed #8a6d3b;"></div>
              <p style="font-size: 16px; font-weight: 900; color: #1e293b; margin-top: 5px;">إمضاء الأستاذ(ة)</p>
            </div>
          </div>
        </div>
      </div>
    `;

    container.innerHTML = certHtml;

    try {
      const canvas = await html2canvas(container, {
        scale: 3,
        useCORS: true,
        backgroundColor: '#ffffff'
      });
      const imgData = canvas.toDataURL('image/png');
      const pdf = new jsPDF({
        orientation: 'l',
        unit: 'mm',
        format: 'a4'
      });
      pdf.addImage(imgData, 'PNG', 0, 0, 297, 210);
      pdf.save(`شهادة_تميز_${st.name}.pdf`);
    } catch (err) {
      console.error('Cert Error:', err);
    } finally {
      document.body.removeChild(container);
      setDownloadStatus('');
    }
  };

  const generateCertificates = async () => {
    if (eliteStudents.length === 0) return;
    setDownloadStatus('جاري إصدار الشهادات دفعة واحدة...');
    for (const st of eliteStudents) {
      await generateSingleCertificate(st);
      // Short delay between saves
      await new Promise(r => setTimeout(r, 800));
    }
    setDownloadStatus('تم تحميل كافة الشهادات بنجاح!');
    setTimeout(() => setDownloadStatus(''), 5000);
  };

  const generateAiInsights = async () => {
    const aiClient = getGenAI();
    if (!aiClient) {
      alert("يرجى إعداد مفتاح GEMINI_API_KEY لتفعيل التحليل الذكي.");
      return;
    }

    if (!isaStats || !compStats.length) return;
    setIsGeneratingAi(true);
    setActiveModal('ai');
    
    try {
      const statsSummary = `
        المادة: ${teacherInfo?.subject}
        القسم: ${teacherInfo?.className}
        المؤشر العام (ISA2): ${isaStats.isaValue}
        توزيع المستويات:
        - متميز (A): ${isaStats.pA}%
        - متحكم (B): ${isaStats.pB}%
        - متوسط (C): ${isaStats.pC}%
        - متعثر (D): ${isaStats.pD}%
        
        توزيع الكفايات:
        ${compStats.map(c => `- ${c.code}: ${c.D.length} متعثر، ${c.C.length} متوسط`).join('\n')}
      `;

      const model = aiClient.getGenerativeModel({ model: "gemini-1.5-flash" });
      const prompt = `أنت خبير تربوي ومحلل بيداغوجي رقمي.
              بناءً على البيانات المقدمة، قم بصياغة تقرير عالي الجودة يتضمن:
              1. "درجة الجودة التربوية" (درجة من 100 تعبر عن توازن القسم).
              2. "تحليل النبض التعليمي": ملخص سردي مشوق.
              3. "خارطة طريق الدعم": 3 خطوات عملية جداً وملموسة.
              4. "توقعات المستقبل": كيف سيتطور القسم إذا استمر بنفس الوتيرة.
              
              استخدم لغة قوية واحترافية والتزم بتنسيق ماركداون مع استخدام الرموز التعبيرية 📊💡🚀.
              
              البيانات:
              ${statsSummary}`;

      const result = await model.generateContent(prompt);
      const response = await result.response;
      setAiReport(response.text() || 'عذراً، لم نتمكن من توليد التقرير حالياً.');
    } catch (err) {
      console.error('AI Error:', err);
      setAiReport('حدث خطأ أثناء التواصل مع المحرك الذكي. يرجى محاولة التحديث.');
    } finally {
      setIsGeneratingAi(false);
    }
  };

  const radarData = compStats.slice(0, 7).map(c => {
    const totalWithData = c.A.length + c.B.length + c.C.length + c.D.length;
    const health = totalWithData > 0 
      ? ((c.A.length * 10 + c.B.length * 8 + c.C.length * 5 + c.D.length * 2) / (totalWithData * 10)) * 100
      : 0;
    return {
      subject: c.code,
      score: health,
      fullMark: 100
    };
  });

  const exportStruggleToExcel = () => {
    const data = compStats.map(cs => ({
      'المعيار/الكفاية': cs.code,
      'فئة C (متوسط)': cs.C.join('، '),
      'فئة D (متعثر)': cs.D.join('، ')
    }));

    const ws = XLSX.utils.json_to_sheet(data);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, "خارطة المتعثرين");
    XLSX.writeFile(wb, `خارطة_المتعثرين_${teacherInfo?.className}.xlsx`);
  };

  const chartData = isaStats ? [
    { name: 'متميز (A)', value: isaStats.pA, color: '#059669' },
    { name: 'متحكم (B)', value: isaStats.pB, color: '#10b981' },
    { name: 'متوسط (C)', value: isaStats.pC, color: '#fbbf24' },
    { name: 'متعثر (D)', value: isaStats.pD, color: '#f43f5e' },
  ] : [];

  return (
    <div className="min-h-screen p-4 md:p-8 max-w-5xl mx-auto font-sans" dir="rtl">
      {/* Welcome Popup Modal */}
      <AnimatePresence>
        {showWelcome && (
          <motion.div 
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 z-[100] flex items-center justify-center p-6 bg-slate-900/60 backdrop-blur-sm"
          >
            <motion.div 
              initial={{ scale: 0.9, y: 20 }}
              animate={{ scale: 1, y: 0 }}
              className="bg-white rounded-[3rem] p-8 md:p-12 max-w-xl w-full shadow-2xl border border-slate-100 relative overflow-hidden"
            >
               <div className="absolute top-0 right-0 w-64 h-64 bg-amber-50 rounded-full -mr-32 -mt-32 opacity-50"></div>
               
               <div className="relative z-10 text-center">
                  <div className="w-16 h-16 bg-amber-500 rounded-2xl flex items-center justify-center text-white mx-auto mb-6 shadow-xl shadow-amber-200">
                     <Info size={32} />
                  </div>
                  
                  <h2 className="text-3xl font-black text-slate-900 mb-6">توضيح هام لمستخدمي ISA</h2>
                  
                  <div className="space-y-4 text-right mb-10">
                     <p className="text-slate-600 font-bold leading-relaxed">
                        نرحّب بكم في النسخة الأولى لمشروع <span className="text-emerald-600 font-black">ISA</span>. نود توضيح أن هذا الموقع هو ثمرة اجتهاد شخصي من طرف أستاذ غيور على مصلحة المتعلمين.
                     </p>
                     <p className="text-slate-600 font-bold leading-relaxed">
                        لقد تم بناء هذه المنصة وهندستها كلياً بواسطة <span className="text-amber-600 font-black">نماذج الذكاء الاصطناعي المتطورة</span>، وهو مجرد نموذج تجريبي قد تظهر فيه بعض الأخطاء التقنية أو المنهجية أحياناً.
                     </p>
                     <p className="text-slate-500 text-sm font-medium italic">
                        * نشكر تفهمكم ونسعى دائماً لتطوير الأداة بما يخدم التحليل البيداغوجي الموجه.
                     </p>
                  </div>
                  
                  <button 
                    onClick={closeWelcome}
                    className="w-full bg-slate-900 hover:bg-slate-800 text-white py-4 rounded-2xl font-black transition-all shadow-xl shadow-slate-200 active:scale-95"
                  >
                     فهمت، لنبدأ العمل
                  </button>
               </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>

      <header className="text-center mb-10">
        <motion.div 
          initial={{ opacity: 0, scale: 0.8 }}
          animate={{ opacity: 1, scale: 1 }}
          className="inline-block bg-emerald-100 p-3 rounded-2xl mb-4"
        >
          <TrendingUp size={32} className="text-emerald-600" />
        </motion.div>
        <motion.h1 
          initial={{ opacity: 0, y: -20 }}
          animate={{ opacity: 1, y: 0 }}
          className="text-4xl font-extrabold text-slate-900 mb-2"
        >
          حساب مؤشر تتبع التعلم ISA
        </motion.h1>
        <p className="text-slate-500 font-medium tracking-wide prose max-w-none">منصة احترافية لتحليل مؤشرات الأداء ودعم التحصيل الدراسي</p>
      </header>

      {/* File Upload Section */}
      <section className="bg-white rounded-3xl p-8 shadow-sm border border-slate-100 mb-8 transition-all hover:shadow-md">
        <div className="max-w-2xl mx-auto">
          <div className="max-w-xs mx-auto mb-8 text-right bg-slate-50 p-6 rounded-2xl border border-slate-100 shadow-inner">
            <label className="block text-xs font-black text-slate-500 mb-2 mr-1 uppercase tracking-tighter">المؤشر السابق للمقارنة (اختياري)</label>
            <input 
              type="number" 
              step="0.01"
              value={prevIsaValue}
              onChange={(e) => setPrevIsaValue(e.target.value)}
              placeholder="مثال: 75.20"
              className="w-full bg-white border-2 border-slate-200 rounded-xl px-4 py-3 text-center font-black text-slate-800 focus:border-emerald-500 transition-all outline-none shadow-sm"
            />
          </div>

          <label className="block text-center cursor-pointer group">
            <div className="border-2 border-dashed border-slate-200 group-hover:border-emerald-400 rounded-3xl p-12 transition-all bg-slate-50 group-hover:bg-emerald-50/30">
              <div className="bg-emerald-500 text-white w-14 h-14 rounded-2xl flex items-center justify-center mx-auto mb-5 group-hover:scale-110 transition-transform shadow-xl shadow-emerald-500/20">
                <FileUp size={28} />
              </div>
              <h2 className="text-xl font-bold text-slate-800 mb-2">رفع ملف النتائج</h2>
              <p className="text-slate-400 text-sm max-w-xs mx-auto leading-relaxed mb-6">يرجى اختيار ملف إكسيل يحتوي على نتائج التلاميذ بصيغة XLSX أو XLS</p>
              
              <input 
                type="file" 
                className="hidden" 
                onChange={handleFileUpload} 
                ref={fileInputRef}
                accept=".xlsx,.xls"
              />
            </div>
          </label>
          
          <AnimatePresence>
            {excelData && (
              <motion.div 
                initial={{ opacity: 0, y: 10 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0 }}
                className="mt-8 flex justify-center"
              >
                <button 
                  onClick={processData}
                  disabled={loading}
                  className="bg-emerald-600 hover:bg-emerald-700 disabled:bg-emerald-400 text-white px-12 py-4 rounded-2xl font-bold text-lg flex items-center gap-3 shadow-xl shadow-emerald-600/30 transition-all active:scale-95"
                >
                  {loading ? "جاري المعالجة..." : "تحليل البيانات واستخراج النتائج"}
                  <LayoutDashboard size={22} />
                </button>
              </motion.div>
            )}
          </AnimatePresence>
        </div>
      </section>

      {/* Results Dashboard */}
      <AnimatePresence>
        {teacherInfo && isaStats && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            className="space-y-6"
          >
            {/* Header Section */}
            <div className="flex justify-between items-center bg-white p-4 rounded-2xl border border-slate-200 shadow-sm">
              <div className="flex items-center gap-4">
                <div className="w-12 h-12 bg-emerald-600 rounded-xl flex items-center justify-center shadow-lg shadow-emerald-200">
                  <span className="text-white font-bold text-xl">ISA</span>
                </div>
                <div>
                  <h2 className="text-xl font-black text-slate-800 tracking-tight">نظام ISA2 المتكامل</h2>
                  <p className="text-slate-500 text-xs font-medium italic">منصة تحليل الأداء التربوي والتقويم</p>
                </div>
              </div>
              <div className="hidden md:flex gap-3">
                <div className="bg-emerald-50 px-4 py-2 rounded-full border border-emerald-100 flex items-center gap-2">
                  <div className="w-2 h-2 rounded-full bg-emerald-500 animate-pulse"></div>
                  <span className="text-[10px] font-bold text-emerald-700">تم تحليل البيانات بنجاح</span>
                </div>
              </div>
            </div>

            {/* Main Bento Grid */}
            <div className="grid grid-cols-12 gap-6">
              
              {/* Hero Metric: ISA2 Index */}
              <div className="col-span-12 lg:col-span-4 bg-slate-900 rounded-[2.5rem] p-8 flex flex-col items-center justify-center shadow-2xl relative overflow-hidden min-h-[380px] border border-slate-800">
                <div className="absolute top-0 left-0 w-full h-full opacity-20 pointer-events-none">
                  <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-[300px] h-[300px] bg-emerald-500/20 blur-[100px] rounded-full animate-pulse"></div>
                </div>

                <div className="relative z-10 text-center w-full">
                  <p className="text-emerald-400 font-black uppercase tracking-[0.2em] text-[10px] mb-6">ISA2 ANALYTICS INDEX</p>
                  
                  <div className="relative inline-flex items-center justify-center mb-6">
                    {/* Visual Gauge Circle */}
                    <svg className="w-48 h-48 transform -rotate-90">
                      <circle
                        cx="96"
                        cy="96"
                        r="88"
                        stroke="currentColor"
                        strokeWidth="12"
                        fill="transparent"
                        className="text-slate-800"
                      />
                      <motion.circle
                        cx="96"
                        cy="96"
                        r="88"
                        stroke="currentColor"
                        strokeWidth="12"
                        fill="transparent"
                        strokeDasharray={552.92}
                        initial={{ strokeDashoffset: 552.92 }}
                        animate={{ strokeDashoffset: 552.92 - (552.92 * Math.min(parseFloat(isaStats.isaValue), 100) / 100) }}
                        transition={{ duration: 1.5, ease: "easeOut" }}
                        className="text-emerald-500"
                        strokeLinecap="round"
                      />
                    </svg>
                    
                    <div className="absolute inset-0 flex flex-col items-center justify-center">
                      <span className="text-6xl font-black text-white tracking-tighter drop-shadow-lg">
                        {isaStats.isaValue}
                      </span>
                    </div>
                  </div>

                  <div className="flex flex-col items-center gap-3">
                    <div className="px-5 py-2 bg-white/5 border border-white/10 rounded-2xl backdrop-blur-sm">
                      <p className="text-slate-400 text-[10px] font-bold uppercase mb-1">المستوى العام</p>
                      <p className="text-emerald-400 font-black text-sm">
                        {parseFloat(isaStats.isaValue) >= 80 ? 'أداء استثنائي' : 
                         parseFloat(isaStats.isaValue) >= 60 ? 'أداء مستقر' : 'يحتاج خطة دعم'}
                      </p>
                    </div>

                    {prevIsaValue && !isNaN(parseFloat(prevIsaValue)) && (
                      <motion.div 
                        initial={{ opacity: 0, y: 10 }}
                        animate={{ opacity: 1, y: 0 }}
                        className={`flex items-center gap-2 px-4 py-2 rounded-xl font-black text-xs border shadow-lg ${
                          parseFloat(isaStats.isaValue) >= parseFloat(prevIsaValue) 
                            ? 'bg-emerald-500/10 text-emerald-400 border-emerald-500/20' 
                            : 'bg-rose-500/10 text-rose-400 border-rose-500/20'
                        }`}
                      >
                        {parseFloat(isaStats.isaValue) >= parseFloat(prevIsaValue) ? (
                          <>
                            <TrendingUp size={14} />
                            <span>نمو إيجابي: +{(parseFloat(isaStats.isaValue) - parseFloat(prevIsaValue)).toFixed(2)}</span>
                          </>
                        ) : (
                          <>
                            <TrendingUp size={14} className="rotate-180" />
                            <span>تراجع في المؤشر: {(parseFloat(isaStats.isaValue) - parseFloat(prevIsaValue)).toFixed(2)}</span>
                          </>
                        )}
                      </motion.div>
                    )}
                  </div>
                </div>
              </div>

              {/* Metadata Card */}
              <div className="col-span-12 md:col-span-7 lg:col-span-5 bg-white rounded-[2rem] p-6 shadow-sm border border-slate-200">
                <h3 className="text-slate-800 font-bold mb-6 flex items-center gap-2">
                  <span className="w-1.5 h-6 bg-blue-500 rounded-full"></span>
                  تفاصيل الجلسة
                </h3>
                <div className="grid grid-cols-2 gap-4">
                  <div className="bg-slate-50 p-4 rounded-2xl border border-slate-100">
                    <p className="text-slate-400 text-[10px] font-bold mb-1 uppercase">المادة</p>
                    <p className="text-slate-800 font-black truncate">{teacherInfo.subject}</p>
                  </div>
                  <div className="bg-slate-50 p-4 rounded-2xl border border-slate-100">
                    <p className="text-slate-400 text-[10px] font-bold mb-1 uppercase">المستوى</p>
                    <p className="text-slate-800 font-black truncate">{teacherInfo.level}</p>
                  </div>
                  <div className="bg-slate-50 p-4 rounded-2xl border border-slate-100">
                    <p className="text-slate-400 text-[10px] font-bold mb-1 uppercase">القسم</p>
                    <p className="text-slate-800 font-black truncate">{teacherInfo.className}</p>
                  </div>
                  <div className="bg-slate-50 p-4 rounded-2xl border border-slate-100">
                    <p className="text-slate-400 text-[10px] font-bold mb-1 uppercase">المرحلة</p>
                    <p className="text-slate-800 font-black truncate">{teacherInfo.stage}</p>
                  </div>
                </div>
              </div>

              {/* Stats Summary Card */}
              <div className="col-span-12 md:col-span-5 lg:col-span-3 bg-white rounded-[2rem] p-6 shadow-sm border border-slate-200 flex flex-col justify-center items-center">
                <div className="w-24 h-24 rounded-full border-[10px] border-emerald-500/20 flex items-center justify-center relative bg-emerald-50/30">
                  <div className="absolute inset-0 rounded-full border-[10px] border-emerald-500 border-t-transparent -rotate-45"></div>
                  <span className="font-black text-3xl text-slate-800">{isaStats.totalStudents}</span>
                  <div className="absolute -top-3 bg-white px-2 py-0.5 rounded-full border border-slate-100 text-[10px] font-bold text-slate-400 shadow-sm">تلميذ</div>
                </div>
                <p className="mt-4 text-slate-600 font-bold">إجمالي المتعلمين</p>
                <p className="text-slate-400 text-[10px] font-medium">نسبة المشاركة: 100%</p>
              </div>

              {/* Performance Distribution Section */}
              <div className="col-span-12 lg:col-span-9 bg-white rounded-[2.5rem] p-8 shadow-sm border border-slate-200 flex flex-col min-h-[450px]">
                <div className="flex flex-col md:flex-row justify-between items-start md:items-center gap-4 mb-10">
                  <h3 className="text-slate-900 font-black text-2xl flex items-center gap-3">
                    <div className="w-2 h-8 bg-emerald-500 rounded-full shadow-lg shadow-emerald-200"></div>
                    توزيع مستويات التحصيل
                  </h3>
                  <div className="flex items-center gap-3 bg-slate-50 p-1.5 rounded-2xl border border-slate-100">
                    <div className="flex items-center gap-2 px-3 py-1.5 rounded-xl border border-white bg-white shadow-sm">
                      <div className="w-2 h-2 rounded-full bg-emerald-500"></div>
                      <span className="text-[11px] font-black text-slate-400">نظام المراقبة:</span>
                      <span className="text-emerald-600 text-[11px] font-black uppercase tracking-tight">ISA2 Active</span>
                    </div>
                  </div>
                </div>

                <div className="flex-1 flex flex-col justify-center">
                  <div className="bg-slate-50 p-10 rounded-[3rem] border border-slate-100 shadow-inner mb-6">
                    <div className="flex justify-between items-end mb-6">
                      <div className="flex flex-col">
                        <span className="text-[10px] font-black text-slate-400 uppercase tracking-[0.2em] mb-1">المؤشر العام للتحصيل</span>
                        <span className="text-4xl font-black text-slate-800 tracking-tighter">{(isaStats.pA + isaStats.pB + isaStats.pC + isaStats.pD).toFixed(0)}% <span className="text-sm text-slate-400 font-bold">نسبة المشاركة</span></span>
                      </div>
                      <div className="text-left">
                        {(() => {
                          const stats = [
                            { label: 'تميز (A)', val: isaStats.pA, color: 'text-emerald-700', bg: 'bg-emerald-100', border: 'border-emerald-200' },
                            { label: 'تحكم (B)', val: isaStats.pB, color: 'text-emerald-600', bg: 'bg-emerald-200/50', border: 'border-emerald-300/30' },
                            { label: 'متوسط (C)', val: isaStats.pC, color: 'text-amber-700', bg: 'bg-amber-100', border: 'border-amber-200' },
                            { label: 'تعثر (D)', val: isaStats.pD, color: 'text-rose-700', bg: 'bg-rose-100', border: 'border-rose-200' },
                          ];
                          const dominant = stats.reduce((prev, current) => (prev.val > current.val) ? prev : current);
                          return (
                            <span className={`${dominant.bg} ${dominant.color} px-4 py-2 rounded-xl text-[10px] font-black border ${dominant.border} shadow-sm animate-pulse`}>
                              الفئة السائدة: {dominant.label}
                            </span>
                          );
                        })()}
                      </div>
                    </div>

                    <div className="h-16 w-full bg-slate-200 rounded-[1.5rem] overflow-hidden flex shadow-2xl p-1.5 gap-1.5">
                      <motion.div 
                        initial={{ width: 0 }}
                        animate={{ width: `${isaStats.pA}%` }}
                        className="h-full bg-emerald-600 rounded-xl relative group"
                      >
                        <div className="absolute inset-0 bg-white/10 opacity-0 group-hover:opacity-100 transition-opacity"></div>
                      </motion.div>
                      <motion.div 
                        initial={{ width: 0 }}
                        animate={{ width: `${isaStats.pB}%` }}
                        className="h-full bg-emerald-400 rounded-xl relative group"
                      >
                         <div className="absolute inset-0 bg-white/10 opacity-0 group-hover:opacity-100 transition-opacity"></div>
                      </motion.div>
                      <motion.div 
                        initial={{ width: 0 }}
                        animate={{ width: `${isaStats.pC}%` }}
                        className="h-full bg-amber-400 rounded-xl relative group"
                      >
                         <div className="absolute inset-0 bg-white/10 opacity-0 group-hover:opacity-100 transition-opacity"></div>
                      </motion.div>
                      <motion.div 
                        initial={{ width: 0 }}
                        animate={{ width: `${isaStats.pD}%` }}
                        className="h-full bg-rose-500 rounded-xl relative group"
                      >
                         <div className="absolute inset-0 bg-white/10 opacity-0 group-hover:opacity-100 transition-opacity"></div>
                      </motion.div>
                    </div>

                    <div className="grid grid-cols-2 md:grid-cols-4 gap-8 mt-10">
                      {[
                        { label: 'تميز (A)', val: isaStats.pA, color: 'bg-emerald-600' },
                        { label: 'تحكم (B)', val: isaStats.pB, color: 'bg-emerald-400' },
                        { label: 'متوسط (C)', val: isaStats.pC, color: 'bg-amber-400' },
                        { label: 'تعثر (D)', val: isaStats.pD, color: 'bg-rose-500' },
                      ].map((item, i) => (
                        <div key={i} className="flex items-center gap-3">
                          <div className={`w-3 h-3 rounded-full ${item.color} shadow-lg shadow-black/5`}></div>
                          <div>
                            <p className="text-[10px] font-black text-slate-400 mb-0.5">{item.label}</p>
                            <p className="text-xl font-black text-slate-700 tracking-tighter">{item.val.toFixed(1)}%</p>
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>
                </div>

                <div className="mt-8 pt-6 border-t border-slate-100 flex flex-col sm:flex-row justify-between items-center gap-4">
                  <div className="flex items-center gap-6">
                    <div className="flex items-center gap-2">
                      <div className="w-2.5 h-2.5 bg-emerald-500 rounded-full shadow-[0_0_10px_rgba(16,185,129,0.4)]"></div>
                      <span className="text-[11px] font-bold text-slate-600">المؤشرات الإيجابية: {(isaStats.pA + isaStats.pB).toFixed(1)}%</span>
                    </div>
                    <div className="flex items-center gap-2">
                      <div className="w-2.5 h-2.5 bg-rose-500 rounded-full shadow-[0_0_10px_rgba(244,63,94,0.4)]"></div>
                      <span className="text-[11px] font-bold text-slate-600">حاجة الدعم: {(isaStats.pD).toFixed(1)}%</span>
                    </div>
                  </div>
                  <div className="flex items-center gap-4">
                    <span className="text-[9px] font-black text-slate-300 uppercase tracking-widest">ISA2 Performance Matrix</span>
                    <div className="w-8 h-px bg-slate-100"></div>
                  </div>
                </div>
              </div>

              {/* Quick Action Side-Grid */}
              <div className="col-span-12 lg:col-span-3 grid grid-cols-1 md:grid-cols-2 lg:grid-cols-1 gap-4">
                <button 
                  onClick={() => setActiveModal('students')}
                  className="bg-blue-600 hover:bg-blue-700 text-white rounded-[2rem] p-6 flex flex-col justify-between group transition-all shadow-lg active:scale-95"
                >
                  <div className="bg-white/20 w-10 h-10 rounded-xl flex items-center justify-center mb-4 group-hover:scale-110 transition-transform">
                    <LayoutDashboard size={20} />
                  </div>
                  <div className="flex justify-between items-center w-full">
                    <span className="font-black text-lg">بـطاقـات التلاميذ</span>
                    <span className="text-[10px] font-black opacity-60">STUDENTS</span>
                  </div>
                </button>
                <button 
                  onClick={() => setActiveModal('comp')}
                  className="bg-indigo-600 hover:bg-indigo-700 text-white rounded-[2rem] p-6 flex flex-col justify-between group transition-all shadow-lg active:scale-95"
                >
                  <div className="bg-white/20 w-10 h-10 rounded-xl flex items-center justify-center mb-4 group-hover:rotate-12 transition-transform">
                    <Search size={20} />
                  </div>
                  <div className="flex justify-between items-center w-full">
                    <span className="font-black text-lg">تحليل الكفايات</span>
                    <span className="text-[10px] font-black opacity-60">DETAILED</span>
                  </div>
                </button>
                <button 
                  onClick={() => setActiveModal('struggle')}
                  className="bg-rose-500 hover:bg-rose-600 text-white rounded-[2rem] p-6 flex flex-col justify-between group transition-all shadow-lg active:scale-95"
                >
                  <div className="bg-white/20 w-10 h-10 rounded-xl flex items-center justify-center mb-4 group-hover:-rotate-12 transition-transform">
                    <AlertTriangle size={20} />
                  </div>
                  <div className="flex justify-between items-center w-full">
                    <span className="font-black text-lg">خارطة المتعثرين</span>
                    <span className="text-[10px] font-black opacity-60">REMEDIAL</span>
                  </div>
                </button>
                <button 
                  onClick={generateAiInsights}
                  className="bg-slate-900 hover:bg-slate-800 text-white rounded-[2rem] p-6 flex flex-col justify-between group transition-all shadow-xl active:scale-95 ring-4 ring-emerald-500/10"
                >
                  <div className="bg-emerald-500 w-10 h-10 rounded-xl flex items-center justify-center mb-4 group-hover:scale-110 transition-transform">
                    <BrainCircuit size={20} />
                  </div>
                  <div className="flex justify-between items-center w-full text-right">
                    <div className="flex flex-col">
                      <span className="font-black text-lg leading-tight">التحليل الذكي</span>
                      <span className="text-[9px] font-black text-emerald-400">AI PEDAGOGY POWERED</span>
                    </div>
                    <ChevronRight size={18} className="opacity-40" />
                  </div>
                </button>
                <button 
                  onClick={() => setActiveModal('honor')}
                  className="bg-amber-400 hover:bg-amber-500 text-slate-900 rounded-[2rem] p-6 flex flex-col justify-between group transition-all shadow-lg active:scale-95"
                >
                  <div className="bg-slate-900/10 w-10 h-10 rounded-xl flex items-center justify-center mb-4 group-hover:scale-110 transition-transform text-slate-900">
                    <Trophy size={20} />
                  </div>
                  <div className="flex justify-between items-center w-full">
                    <span className="font-black text-lg">لوحة التميز</span>
                    <span className="text-[10px] font-black opacity-40">EXCELLENCE</span>
                  </div>
                </button>
              </div>

            </div>

            {/* Footer Bar */}
            <div className="flex flex-col md:flex-row justify-between items-center gap-4 px-6 py-4 bg-slate-100 rounded-2xl border border-slate-200 mt-6">
              <p className="text-xs font-bold text-slate-500">
                تاريخ الاستخراج: {new Date().toLocaleDateString('ar-MA')} | {new Date().toLocaleTimeString('ar-MA', { hour: '2-digit', minute: '2-digit' })}
              </p>
              <div className="flex gap-4">
                <span className="text-[9px] font-black uppercase text-slate-400 tracking-tighter bg-white px-3 py-1 rounded-full border border-slate-200">
                  ISA2 ADVANCED ANALYTICS ENGINE v2.0.0
                </span>
              </div>
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Modals Implementation */}
      <AnimatePresence>
        {activeModal && (
          <div className="fixed inset-0 z-50 flex items-center justify-center p-4 md:p-8">
            <motion.div 
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              onClick={() => setActiveModal(null)}
              className="absolute inset-0 bg-slate-950/70 backdrop-blur-md"
            />
            <motion.div 
              initial={{ opacity: 0, scale: 0.95, y: 20 }}
              animate={{ opacity: 1, scale: 1, y: 0 }}
              exit={{ opacity: 0, scale: 0.95, y: 20 }}
              className="relative bg-white w-full max-w-5xl max-h-[90vh] rounded-[2.5rem] shadow-2xl overflow-hidden flex flex-col"
            >
              <div className="p-8 border-b border-slate-100 flex items-center justify-between sticky top-0 bg-white/80 backdrop-blur-md z-12">
                <div>
                  <h3 className="text-3xl font-black text-slate-900 leading-tight">
                    {activeModal === 'comp' && 'توزيع المتعلمين حسب الكفايات'}
                    {activeModal === 'struggle' && 'تقرير تشخيص الفئات الهشة'}
                    {activeModal === 'honor' && 'لوحة الشرف والتميز'}
                    {activeModal === 'ai' && 'التحليل البيداغوجي الذكي'}
                    {activeModal === 'students' && (selectedStudentDetails ? `ملف التلميذ: ${selectedStudentDetails.name}` : 'مستكشف نتائج التلاميذ')}
                  </h3>
                  <p className="text-slate-400 text-sm font-medium mt-1">
                    {selectedStudentDetails ? `المعدل العام: ${selectedStudentDetails.average?.toFixed(2)}` : `تفصيل دقيق لنتائج القسم: ${teacherInfo?.className}`}
                  </p>
                </div>
                <div className="flex items-center gap-4">
                  {selectedStudentDetails && (
                    <button 
                      onClick={() => setSelectedStudentDetails(null)}
                      className="bg-slate-100 text-slate-600 px-4 py-2 rounded-xl text-sm font-black hover:bg-slate-200 transition-all"
                    >
                      عودة للقائمة
                    </button>
                  )}
                  <button 
                    onClick={() => {
                      setActiveModal(null);
                      setSelectedStudentDetails(null);
                    }}
                    className="bg-slate-100 p-3 rounded-2xl text-slate-500 hover:bg-rose-50 hover:text-rose-600 transition-all active:scale-90"
                  >
                    <X size={24} />
                  </button>
                </div>
              </div>

              <div className="p-8 overflow-y-auto scrollbar-hide">
                {activeModal === 'students' && !selectedStudentDetails && (
                  <div className="space-y-6">
                    <div className="flex flex-col md:flex-row gap-4 mb-8">
                      <div className="relative flex-1">
                        <Search size={20} className="absolute right-4 top-1/2 -translate-y-1/2 text-slate-400" />
                        <input 
                          type="text" 
                          placeholder="ابحث عن اسم تلميذ..."
                          className="w-full bg-slate-50 border border-slate-200 rounded-[1.2rem] py-3 pr-12 pl-6 text-base font-bold text-slate-800 outline-none focus:ring-4 focus:ring-blue-500/10 focus:border-blue-500 transition-all"
                          onChange={(e) => setSearchTerm(e.target.value)}
                        />
                      </div>
                      <div className="flex bg-slate-100 p-1 rounded-xl border border-slate-200">
                        {['All', 'A', 'B', 'C', 'D'].map((lvl) => (
                          <button
                            key={lvl}
                            onClick={() => setFilterLevel(lvl as any)}
                            className={`px-4 py-2 rounded-lg text-xs font-black transition-all ${
                              filterLevel === lvl 
                                ? 'bg-white text-blue-600 shadow-sm' 
                                : 'text-slate-500 hover:text-slate-800'
                            }`}
                          >
                            {lvl === 'All' ? 'الكل' : `فئة ${lvl}`}
                          </button>
                        ))}
                      </div>
                    </div>
                    <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
                      {allStudents
                        .filter(s => s.name.toLowerCase().includes(searchTerm.toLowerCase()))
                        .filter(s => filterLevel === 'All' || s.level === filterLevel)
                        .map((s, idx) => (
                        <button 
                          key={idx}
                          onClick={() => {
                            setSelectedStudentDetails(s);
                            setParentReport('');
                          }}
                          className="bg-white border border-slate-100 p-5 rounded-[2rem] flex flex-col gap-4 text-right hover:shadow-xl hover:border-blue-200 transition-all group"
                        >
                          <div className="flex justify-between items-start">
                            <div className={`w-10 h-10 rounded-xl flex items-center justify-center text-white font-black shadow-lg ${
                              s.level === 'A' ? 'bg-emerald-600 shadow-emerald-100' :
                              s.level === 'B' ? 'bg-emerald-400 shadow-emerald-50' :
                              s.level === 'C' ? 'bg-amber-400 shadow-amber-50' : 'bg-rose-500 shadow-rose-100'
                            }`}>
                              {s.level}
                            </div>
                            <span className="text-2xl font-black text-slate-800 tracking-tighter">{s.average?.toFixed(1)}</span>
                          </div>
                          <div>
                            <p className="text-lg font-black text-slate-800 truncate">{s.name}</p>
                            <p className="text-[10px] font-bold text-slate-400 uppercase">قاعدة البيانات: صفحة {s.idx + 1}</p>
                          </div>
                          <div className="pt-4 border-t border-slate-50 flex justify-between items-center">
                            <span className="text-[10px] font-black text-slate-400">انقر لعرض التفاصيل</span>
                            <ChevronRight size={16} className="text-slate-300 group-hover:translate-x-[-4px] transition-transform" />
                          </div>
                        </button>
                      ))}
                    </div>
                  </div>
                )}

                {activeModal === 'students' && selectedStudentDetails && (
                  <div className="space-y-8 max-w-5xl mx-auto pb-12">
                    {/* Student Hero Header */}
                    <div className="bg-slate-900 rounded-[3rem] p-10 text-white flex flex-col md:flex-row justify-between items-center gap-8 relative overflow-hidden">
                      <div className="absolute top-0 right-0 w-64 h-64 bg-white/5 blur-[80px] rounded-full -mr-32 -mt-32"></div>
                      <div className="relative z-10 flex flex-col items-center md:items-start text-center md:text-right">
                        <h4 className="text-4xl font-black mb-2">{selectedStudentDetails.name}</h4>
                        <div className="flex gap-4">
                          <span className="bg-white/10 px-4 py-1.5 rounded-xl text-xs font-black border border-white/10">{teacherInfo?.className}</span>
                          <span className="bg-white/10 px-4 py-1.5 rounded-xl text-xs font-black border border-white/10 uppercase tracking-tighter">ISA2 ID: {selectedStudentDetails.idx}</span>
                        </div>
                      </div>
                      <div className="relative z-10 flex flex-col items-center">
                         <div className={`w-32 h-32 rounded-full border-8 flex items-center justify-center relative mb-2 ${
                            selectedStudentDetails.level === 'A' ? 'border-emerald-500' :
                            selectedStudentDetails.level === 'B' ? 'border-emerald-400' :
                            selectedStudentDetails.level === 'C' ? 'border-amber-400' : 'border-rose-500'
                         }`}>
                           <span className="text-6xl font-black leading-none">{selectedStudentDetails.level}</span>
                            <div className="absolute -bottom-3 bg-white text-slate-900 px-4 py-1 rounded-full text-sm font-black shadow-xl">
                              {selectedStudentDetails.average?.toFixed(2)}
                            </div>
                         </div>
                         <p className="text-[10px] font-black uppercase text-slate-400 tracking-[0.2em] mt-2">المستوى التحصيلي</p>
                      </div>
                    </div>

                    <div className="grid grid-cols-1 lg:grid-cols-2 gap-8">
                       {/* Left Side: Radar and Individual Scores */}
                       <div className="space-y-8">
                          {/* Radar Chart */}
                          <div className="bg-slate-50 p-8 rounded-[2.5rem] border border-slate-100 flex flex-col items-center shadow-sm">
                            <h5 className="text-[10px] font-black text-slate-400 uppercase tracking-widest mb-6 border-b-2 border-indigo-500 pb-2">رادار الأداء الفردي</h5>
                            <div className="w-full h-[300px]">
                              <ResponsiveContainer width="100%" height="100%">
                                <RadarChart cx="50%" cy="50%" outerRadius="80%" data={getStudentPerformance(selectedStudentDetails)}>
                                  <PolarGrid stroke="#e2e8f0" />
                                  <PolarAngleAxis 
                                    dataKey="subject" 
                                    tick={{ fill: '#64748b', fontSize: 10, fontWeight: 900 }} 
                                  />
                                  <PolarRadiusAxis angle={30} domain={[0, 100]} hide />
                                  <Radar
                                    name="متوسط القسم"
                                    dataKey="classAvg"
                                    stroke="#0f172a"
                                    fill="#0f172a"
                                    fillOpacity={0.1}
                                  />
                                  <Radar
                                    name={selectedStudentDetails.name}
                                    dataKey="score"
                                    stroke="#6366f1"
                                    fill="#6366f1"
                                    fillOpacity={0.5}
                                  />
                                  <Tooltip />
                                </RadarChart>
                              </ResponsiveContainer>
                            </div>
                            <div className="flex gap-4 mt-4 text-[9px] font-black uppercase">
                               <div className="flex items-center gap-1.5"><div className="w-2 h-2 rounded-full bg-[#6366f1]"></div> التلميذ</div>
                               <div className="flex items-center gap-1.5"><div className="w-2 h-2 rounded-full bg-[#0f172a]"></div> متوسط القسم</div>
                            </div>
                          </div>

                          {/* Scores Grid */}
                          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                            {selectedStudentDetails.scores?.map((score, i) => (
                              <div key={i} className="bg-white border border-slate-100 rounded-2xl p-5 flex flex-col justify-between shadow-sm">
                                <div className="flex justify-between items-center mb-3">
                                  <div className="bg-slate-50 px-3 py-1 rounded-lg border border-slate-200 text-[10px] font-black text-slate-400">{score.code}</div>
                                  <span className={`text-xl font-black ${
                                    score.value >= 8 ? 'text-emerald-600' :
                                    score.value >= 6 ? 'text-emerald-400' :
                                    score.value >= 4 ? 'text-amber-500' : 'text-rose-500'
                                  }`}>{score.value.toFixed(1)}</span>
                                </div>
                                <div className="h-1.5 w-full bg-slate-100 rounded-full overflow-hidden">
                                   <motion.div 
                                     initial={{ width: 0 }}
                                     animate={{ width: `${score.value * 10}%` }}
                                     className={`h-full ${
                                        score.value >= 8 ? 'bg-emerald-600' :
                                        score.value >= 6 ? 'bg-emerald-400' :
                                        score.value >= 4 ? 'bg-amber-400' : 'bg-rose-500'
                                     }`}
                                   />
                                </div>
                              </div>
                            ))}
                          </div>
                       </div>

                       {/* Right Side: Parent Report and Strategy */}
                       <div className="flex flex-col h-full space-y-6">
                         {/* AI Support Strategy */}
                         <div className="bg-emerald-50/50 border border-emerald-100 rounded-[2rem] p-6 relative overflow-hidden">
                            <div className="absolute -top-4 -right-4 w-24 h-24 bg-emerald-500/5 blur-2xl rounded-full"></div>
                            <div className="flex justify-between items-center mb-4">
                               <h6 className="text-xs font-black text-emerald-800 flex items-center gap-2">
                                  <BrainCircuit size={16} />
                                  خطة الدعم المقترحة (للمدرس)
                               </h6>
                               {!studentStrategy && !isGeneratingStrategy && (
                                 <button 
                                   onClick={() => generateStudentStrategy(selectedStudentDetails)}
                                   className="text-[9px] font-black bg-white text-emerald-600 px-3 py-1 rounded-lg border border-emerald-200 hover:bg-emerald-500 hover:text-white transition-all shadow-sm"
                                 >
                                   استخلاص الخطة
                                 </button>
                               )}
                            </div>
                            
                            {isGeneratingStrategy ? (
                               <div className="flex items-center gap-3 animate-pulse py-4">
                                  <div className="w-2 h-2 bg-emerald-500 rounded-full"></div>
                                  <span className="text-[10px] font-black text-emerald-600">جاري التفكير البيداغوجي...</span>
                               </div>
                            ) : studentStrategy ? (
                               <div className="text-[11px] font-bold text-emerald-700 space-y-2 leading-relaxed">
                                  {studentStrategy.split('\n').map((l, i) => <p key={i}>{l}</p>)}
                               </div>
                            ) : (
                               <p className="text-[10px] font-bold text-slate-400 italic">اضغط زر "استخلاص" للحصول على توصيات بيداغوجية مخصصة</p>
                            )}
                         </div>

                         <div className="bg-white rounded-[2.5rem] border border-slate-100 p-8 shadow-md flex-1 relative min-h-[400px]">
                           <div className="flex justify-between items-center mb-8">
                             <h5 className="text-xl font-black text-slate-800 flex items-center gap-3">
                               <Sparkles className="text-amber-500" size={24} />
                               تقرير الآباء الذكي
                             </h5>
                           </div>

                           {isGeneratingParentReport ? (
                              <div className="absolute inset-0 flex flex-col items-center justify-center p-10 bg-white/60 backdrop-blur-sm z-10 rounded-[2.5rem]">
                                 <motion.div animate={{ rotate: 360 }} transition={{ repeat: Infinity, duration: 2, ease: "linear" }}>
                                    <Sparkles size={48} className="text-indigo-500" />
                                 </motion.div>
                                 <p className="mt-6 text-slate-900 font-extrabold text-lg">جاري صياغة الخطاب التربوي...</p>
                              </div>
                            ) : null}

                            {parentReport ? (
                              <motion.div 
                                initial={{ opacity: 0 }}
                                animate={{ opacity: 1 }}
                                className="prose prose-slate prose-sm max-w-none rtl"
                              >
                                 {parentReport.split('\n').map((l, i) => (
                                   <p key={i} className="mb-4 text-slate-700 font-medium leading-relaxed text-base">{l}</p>
                                 ))}
                              </motion.div>
                            ) : (
                              <div className="h-full flex flex-col items-center justify-center text-center p-10 space-y-8">
                                 <div className="w-20 h-20 bg-slate-50 rounded-3xl flex items-center justify-center text-slate-200 shadow-inner">
                                    <ScrollText size={40} />
                                 </div>
                                 <div className="space-y-2">
                                    <p className="text-slate-800 font-black text-lg">تحليل تواصل مدرسي</p>
                                    <p className="text-slate-400 font-bold text-sm leading-relaxed">قم بتوليد رسالة رسمية لولي الأمر تشرح حالة التلميذ بأسلوب تربوي بليغ.</p>
                                 </div>
                                 <button 
                                   onClick={() => generateParentReport(selectedStudentDetails)}
                                   className="bg-slate-900 hover:bg-indigo-600 text-white px-10 py-5 rounded-[1.8rem] font-black shadow-xl shadow-slate-900/10 transition-all active:scale-95 flex items-center gap-3"
                                 >
                                   <Sparkles size={20} />
                                   توليد التقرير الآن
                                 </button>
                              </div>
                            )}
                         </div>

                         {parentReport && (
                            <motion.div 
                              initial={{ opacity: 0, y: 10 }}
                              animate={{ opacity: 1, y: 0 }}
                              className="bg-indigo-50 p-6 rounded-[2.2rem] border border-indigo-100 flex gap-4"
                            >
                              <button 
                                onClick={() => {
                                  navigator.clipboard.writeText(parentReport);
                                  alert('تم نسخ التقرير بنجاح!');
                                }}
                                className="flex-1 bg-white text-indigo-600 py-4 rounded-xl font-black shadow-sm border border-indigo-200 hover:bg-indigo-600 hover:text-white transition-all flex items-center justify-center gap-2"
                              >
                                <Copy size={18} />
                                نسخ النص
                              </button>
                              <button 
                                onClick={() => generateParentReport(selectedStudentDetails)}
                                className="w-14 h-14 bg-white text-slate-400 rounded-xl flex items-center justify-center hover:bg-indigo-500 hover:text-white transition-all shadow-sm border border-slate-200"
                                title="إعادة التحرير"
                              >
                                <RefreshCw size={20} />
                              </button>
                            </motion.div>
                          )}
                       </div>
                    </div>
                  </div>
                )}
                {/* UI Improvement for Competency Distribution Modal */}
                {activeModal === 'comp' && (
                  <div className="space-y-10">
                    <div className="bg-slate-900 rounded-[2.5rem] p-10 text-white relative overflow-hidden">
                      <div className="absolute top-0 left-0 w-full h-full bg-[radial-gradient(circle_at_30%_20%,#1e293b_0%,#0f172a_100%)] opacity-50"></div>
                      <div className="relative z-10 flex flex-col md:flex-row justify-between items-center gap-8">
                        <div>
                          <h4 className="text-3xl font-black mb-2">تحليل جودة وتكافؤ الكفايات</h4>
                          <p className="text-slate-400 font-medium tracking-wide">نظرة شاملة على توازن التحصيل الدراسي والكفايات المرصودة</p>
                        </div>
                        <div className="flex gap-4">
                           <div className="bg-white/10 px-6 py-3 rounded-2xl border border-white/10 text-center">
                             <div className="text-[10px] font-black text-slate-400 uppercase mb-1">إجمالي الكفايات</div>
                             <div className="text-2xl font-black">{compStats.length}</div>
                           </div>
                           {(() => {
                             const totalA = compStats.reduce((acc, curr) => acc + curr.A.length, 0);
                             const totalB = compStats.reduce((acc, curr) => acc + curr.B.length, 0);
                             const totalAll = compStats.reduce((acc, curr) => acc + curr.A.length + curr.B.length + curr.C.length + curr.D.length, 0);
                             const masteryRate = totalAll > 0 ? ((totalA + totalB) / totalAll) * 100 : 0;
                             
                             let statusText = "مستقر";
                             let statusColor = "text-emerald-400";
                             let bgColor = "bg-emerald-500/20";
                             
                             if (masteryRate > 80) { statusText = "ممتاز"; statusColor = "text-emerald-400"; }
                             else if (masteryRate > 60) { statusText = "جيد جداً"; statusColor = "text-emerald-300"; }
                             else if (masteryRate > 40) { statusText = "مستقر"; statusColor = "text-amber-400"; }
                             else { statusText = "أولوية دعم"; statusColor = "text-rose-400"; bgColor = "bg-rose-500/20"; }

                             return (
                               <>
                                 <div className="bg-white/5 px-6 py-3 rounded-2xl border border-white/10 text-center">
                                   <div className="text-[10px] font-black text-slate-400 uppercase mb-1">نسبة التمكن (&gt;6)</div>
                                   <div className="text-2xl font-black text-indigo-400">{masteryRate.toFixed(0)}%</div>
                                 </div>
                                 <div className={`${bgColor} px-6 py-3 rounded-2xl border border-white/10 text-center`}>
                                   <div className="text-[10px] font-black text-slate-400 uppercase mb-1">الوضع العام</div>
                                   <div className={`text-2xl font-black ${statusColor}`}>{statusText}</div>
                                 </div>
                               </>
                             );
                           })()}
                        </div>
                      </div>
                    </div>

                    <div className="relative">
                      <Search size={22} className="absolute right-5 top-1/2 -translate-y-1/2 text-slate-400" />
                      <input 
                        type="text" 
                        placeholder="ابحث عن كفاية محددة أو رمز معين..."
                        className="w-full bg-white border-2 border-slate-100 rounded-[1.8rem] py-5 pr-14 pl-8 text-xl font-bold text-slate-800 outline-none focus:ring-8 focus:ring-indigo-500/5 focus:border-indigo-500 transition-all shadow-sm"
                        onChange={(e) => setSearchTerm(e.target.value)}
                      />
                    </div>

                    <div className="grid grid-cols-1 md:grid-cols-2 gap-8">
                      {compStats
                        .filter(cs => cs.code.toLowerCase().includes(searchTerm.toLowerCase()))
                        .map((cs, idx) => {
                          const totalS = cs.A.length + cs.B.length + cs.C.length + cs.D.length;
                          const dRatio = totalS > 0 ? (cs.D.length / totalS) * 100 : 0;
                          const cRatio = totalS > 0 ? (cs.C.length / totalS) * 100 : 0;
                          const status = dRatio > 30 ? 'critical' : (dRatio > 15 ? 'warning' : 'healthy');

                          return (
                            <motion.div 
                              key={idx}
                              layout
                              initial={{ opacity: 0, y: 10 }}
                              animate={{ opacity: 1, y: 0 }}
                              className="bg-white border-2 border-slate-100 rounded-[2.5rem] overflow-hidden group hover:border-indigo-100 hover:shadow-xl transition-all"
                            >
                              <div className="p-8">
                                <div className="flex justify-between items-start mb-6">
                                  <div className="bg-slate-100 px-4 py-2 rounded-xl text-sm font-black text-slate-500 border border-slate-200">
                                    {cs.code}
                                  </div>
                                  <div className={`px-4 py-1.5 rounded-full text-[10px] font-black uppercase tracking-[0.15em] border ${
                                    status === 'critical' ? 'bg-rose-50 text-rose-500 border-rose-100' :
                                    status === 'warning' ? 'bg-amber-50 text-amber-500 border-amber-100' :
                                    'bg-emerald-50 text-emerald-500 border-emerald-100'
                                  }`}>
                                    {status === 'critical' ? 'حالة حرجة' : status === 'warning' ? 'تحتاج مراقبة' : 'وضع سليم'}
                                  </div>
                                </div>

                                <div className="space-y-4 mb-6">
                                  <div className="flex justify-between text-xs font-black">
                                    <span className="text-slate-400 uppercase">توزيع الفئات (A, B, C, D)</span>
                                    <span className="text-slate-800 tracking-tighter">{(dRatio + cRatio).toFixed(1)}% متعثر/متوسط</span>
                                  </div>
                                  <div className="h-4 bg-slate-100 rounded-full overflow-hidden flex shadow-inner">
                                    <div style={{ width: `${(cs.A.length / totalS) * 100}%` }} className="h-full bg-emerald-600 transition-all duration-1000"></div>
                                    <div style={{ width: `${(cs.B.length / totalS) * 100}%` }} className="h-full bg-emerald-400 transition-all duration-1000"></div>
                                    <div style={{ width: `${cRatio}%` }} className="h-full bg-amber-400 transition-all duration-1000"></div>
                                    <div style={{ width: `${dRatio}%` }} className="h-full bg-rose-500 transition-all duration-1000"></div>
                                  </div>
                                </div>

                                <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
                                  <div className="bg-emerald-50/50 p-3 rounded-2xl border border-emerald-100">
                                    <div className="text-[10px] font-black text-emerald-600 uppercase mb-1 text-center">ألف (A)</div>
                                    <div className="text-lg font-black text-emerald-700 tracking-tighter text-center">{cs.A.length}</div>
                                  </div>
                                  <div className="bg-emerald-50/20 p-3 rounded-2xl border border-emerald-50">
                                    <div className="text-[10px] font-black text-emerald-400 uppercase mb-1 text-center">باء (B)</div>
                                    <div className="text-lg font-black text-emerald-500 tracking-tighter text-center">{cs.B.length}</div>
                                  </div>
                                  <div className="bg-amber-50/50 p-3 rounded-2xl border border-amber-100">
                                    <div className="text-[10px] font-black text-amber-500 uppercase mb-1 text-center">جيم (C)</div>
                                    <div className="text-lg font-black text-amber-600 tracking-tighter text-center">{cs.C.length}</div>
                                  </div>
                                  <div className="bg-rose-50/50 p-3 rounded-2xl border border-rose-100">
                                    <div className="text-[10px] font-black text-rose-400 uppercase mb-1 text-center">دال (D)</div>
                                    <div className="text-lg font-black text-rose-600 tracking-tighter text-center">{cs.D.length}</div>
                                  </div>
                                </div>
                              </div>
                              
                              <button 
                                onClick={() => setOpenAccordion(openAccordion === cs.code ? null : cs.code)}
                                className="w-full py-5 bg-slate-50 border-t border-slate-100 text-sm font-black text-slate-500 hover:bg-slate-100 hover:text-slate-800 transition-all flex items-center justify-center gap-2"
                              >
                                {openAccordion === cs.code ? 'إخفاء الأسماء' : 'عرض الأسماء'}
                                <ChevronDown size={14} className={`transition-transform duration-300 ${openAccordion === cs.code ? 'rotate-180' : ''}`} />
                              </button>

                              <AnimatePresence>
                                {openAccordion === cs.code && (
                                  <motion.div
                                    initial={{ height: 0, opacity: 0 }}
                                    animate={{ height: 'auto', opacity: 1 }}
                                    exit={{ height: 0, opacity: 0 }}
                                    className="overflow-hidden bg-white border-t border-slate-100"
                                  >
                                    <div className="p-8 space-y-6">
                                      {cs.A.length > 0 && (
                                        <div>
                                          <p className="text-[10px] font-black text-emerald-600 uppercase mb-2 tracking-widest">المتميزون (A)</p>
                                          <div className="flex flex-wrap gap-2">
                                            {cs.A.map((name, i) => (
                                              <span key={i} className="bg-emerald-50 text-emerald-700 px-3 py-1.5 rounded-xl text-xs font-bold border border-emerald-100">
                                                {name}
                                              </span>
                                            ))}
                                          </div>
                                        </div>
                                      )}
                                      {cs.B.length > 0 && (
                                        <div>
                                          <p className="text-[10px] font-black text-emerald-400 uppercase mb-2 tracking-widest">المتمكنون (B)</p>
                                          <div className="flex flex-wrap gap-2">
                                            {cs.B.map((name, i) => (
                                              <span key={i} className="bg-slate-50 text-emerald-600 px-3 py-1.5 rounded-xl text-xs font-bold border border-emerald-50">
                                                {name}
                                              </span>
                                            ))}
                                          </div>
                                        </div>
                                      )}
                                      {cs.C.length > 0 && (
                                        <div>
                                          <p className="text-[10px] font-black text-amber-500 uppercase mb-2 tracking-widest">المتوسطون (C)</p>
                                          <div className="flex flex-wrap gap-2">
                                            {cs.C.map((name, i) => (
                                              <span key={i} className="bg-amber-50 text-amber-700 px-3 py-1.5 rounded-xl text-xs font-bold border border-amber-100">
                                                {name}
                                              </span>
                                            ))}
                                          </div>
                                        </div>
                                      )}
                                      {cs.D.length > 0 && (
                                        <div>
                                          <p className="text-[10px] font-black text-rose-500 uppercase mb-2 tracking-widest">المتعثرون (D)</p>
                                          <div className="flex flex-wrap gap-2">
                                            {cs.D.map((name, i) => (
                                              <span key={i} className="bg-rose-50 text-rose-700 px-3 py-1.5 rounded-xl text-xs font-bold border border-rose-100">
                                                {name}
                                              </span>
                                            ))}
                                          </div>
                                        </div>
                                      )}
                                    </div>
                                  </motion.div>
                                )}
                              </AnimatePresence>
                            </motion.div>
                          );
                        })}
                    </div>
                  </div>
                )}

                {activeModal === 'struggle' && (
                  <div className="space-y-10">
                    {/* Header & Actions */}
                    <div className="flex flex-col md:flex-row justify-between items-start md:items-center gap-8 bg-slate-900 rounded-[3rem] p-10 text-white shadow-2xl relative overflow-hidden">
                       <div className="absolute top-0 right-0 w-64 h-64 bg-rose-500/10 blur-[100px] rounded-full"></div>
                       <div className="relative z-10 flex items-center gap-6">
                          <div className="w-16 h-16 bg-rose-500 rounded-3xl flex items-center justify-center text-white shadow-xl shadow-rose-900/20 shrink-0">
                             <AlertTriangle size={36} />
                          </div>
                          <div>
                             <h4 className="text-3xl font-black mb-1">خارطة التحليل التشخيصي</h4>
                             <p className="text-slate-400 font-bold text-sm">كشف الفئات الهشة وتخطيط التدخلات البيداغوجية</p>
                          </div>
                       </div>
                       <div className="relative z-10 flex gap-4 w-full md:w-auto">
                         <button 
                           onClick={exportStruggleToExcel}
                           className="flex-1 md:flex-initial bg-white/10 hover:bg-white/20 text-white px-8 py-4 rounded-2xl font-black flex items-center justify-center gap-2 transition-all active:scale-95 text-xs backdrop-blur-md border border-white/10"
                         >
                           <FileSpreadsheet size={18} />
                           Excel
                         </button>
                         <button 
                           onClick={downloadStruggleReport}
                           className="flex-1 md:flex-initial bg-rose-500 hover:bg-rose-600 text-white px-8 py-4 rounded-2xl font-black flex items-center justify-center gap-2 shadow-xl shadow-rose-900/20 transition-all active:scale-95 text-xs"
                         >
                           <Download size={18} />
                           PDF (تحميل للطباعة)
                         </button>
                       </div>
                    </div>

                    {/* Summary Stats Cards */}
                    <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
                       <div className="bg-white p-8 rounded-[2.5rem] border border-slate-100 shadow-sm flex items-center gap-6">
                          <div className="w-14 h-14 bg-rose-50 rounded-2xl flex items-center justify-center text-rose-500 hover:scale-110 transition-transform">
                             <UserMinus size={28} />
                          </div>
                          <div>
                             <div className="text-3xl font-black text-slate-900">
                                {Array.from(new Set(compStats.flatMap(c => [...c.D, ...c.C]))).length}
                             </div>
                             <p className="text-[10px] font-black text-slate-400 uppercase tracking-widest">إجمالي المتعثرين</p>
                          </div>
                       </div>
                       <div className="bg-white p-8 rounded-[2.5rem] border border-slate-100 shadow-sm flex items-center gap-6">
                          <div className="w-14 h-14 bg-amber-50 rounded-2xl flex items-center justify-center text-amber-500 hover:scale-110 transition-transform">
                             <Target size={28} />
                          </div>
                          <div>
                             <div className="text-3xl font-black text-slate-900">
                                {compStats.filter(c => c.D.length > 0).length}
                             </div>
                             <p className="text-[10px] font-black text-slate-400 uppercase tracking-widest">كفايات حرجة</p>
                          </div>
                       </div>
                       <div className="bg-white p-8 rounded-[2.5rem] border border-slate-100 shadow-sm flex items-center gap-6">
                          <div className="w-14 h-14 bg-indigo-50 rounded-2xl flex items-center justify-center text-indigo-500 hover:scale-110 transition-transform">
                             <Zap size={28} />
                          </div>
                          <div>
                             <div className="text-3xl font-black text-slate-800">
                                {compStats.length > 0 ? compStats.sort((a,b) => (b.D.length + b.C.length) - (a.D.length + a.C.length))[0].code : '-'}
                             </div>
                             <p className="text-[10px] font-black text-slate-400 uppercase tracking-widest">الأكثر تعثراً</p>
                          </div>
                       </div>
                    </div>
                    
                    {/* Detailed Cards Grid */}
                    <div className="grid grid-cols-1 lg:grid-cols-2 gap-8 mb-12">
                       {compStats
                         .filter(c => c.D.length > 0 || c.C.length > 0)
                         .sort((a, b) => (b.D.length + b.C.length) - (a.D.length + a.C.length))
                         .map((cs, i) => {
                            const total = cs.A.length + cs.B.length + cs.C.length + cs.D.length;
                            const criticalImpact = Math.round((cs.D.length / total) * 100);
                            const supportImpact = Math.round((cs.C.length / total) * 100);
                            
                            return (
                               <motion.div 
                                 key={i}
                                 initial={{ opacity: 0, y: 20 }}
                                 animate={{ opacity: 1, y: 0 }}
                                 transition={{ delay: i * 0.05 }}
                                 className="bg-white border border-slate-100 rounded-[3rem] overflow-hidden shadow-sm hover:shadow-xl transition-all group flex flex-col"
                               >
                                  <div className="p-8 pb-4">
                                     <div className="flex justify-between items-start mb-6">
                                        <div className="flex items-center gap-4">
                                           <div className="w-12 h-12 bg-slate-900 rounded-xl flex items-center justify-center text-white font-black text-sm">
                                              {cs.code}
                                           </div>
                                           <div>
                                              <h5 className="text-xl font-black text-slate-800">الكفاية {cs.code}</h5>
                                              <p className="text-[9px] font-black text-rose-500 uppercase tracking-widest mt-0.5">Priority Analysis Required</p>
                                           </div>
                                        </div>
                                        <div className={`px-4 py-1.5 rounded-full font-black text-[9px] uppercase tracking-tighter ${criticalImpact > 30 ? 'bg-rose-100 text-rose-600' : 'bg-amber-100 text-amber-600'}`}>
                                           {criticalImpact > 30 ? 'High Alert' : 'Balanced'}
                                        </div>
                                     </div>

                                     {/* Simple Distribution Mini-Bar */}
                                     <div className="h-2 w-full bg-slate-100 rounded-full flex overflow-hidden mb-8">
                                        <div style={{ width: `${criticalImpact}%` }} className="h-full bg-rose-500"></div>
                                        <div style={{ width: `${supportImpact}%` }} className="h-full bg-indigo-400"></div>
                                     </div>
                                  </div>

                                  <div className="flex-1 px-8 pb-8 space-y-6">
                                     {/* Critical (D) */}
                                     <div>
                                        <div className="flex items-center gap-2 mb-3">
                                           <div className="w-1.5 h-4 bg-rose-500 rounded-full"></div>
                                           <span className="font-black text-[11px] text-slate-800 uppercase tracking-tight">تدخل علاجي مستعجل (D)</span>
                                           <span className="text-[10px] font-bold text-slate-400 mr-auto">{cs.D.length} تلاميذ</span>
                                        </div>
                                        <div className="flex flex-wrap gap-1.5">
                                           {cs.D.length > 0 ? cs.D.map((name, idx) => (
                                              <span key={idx} className="bg-rose-50/50 text-rose-800 px-3 py-1.5 rounded-lg text-[10px] font-bold border border-rose-100/50 hover:bg-rose-100 transition-colors cursor-default">
                                                 {name}
                                              </span>
                                           )) : (
                                              <span className="text-[10px] font-bold text-slate-300 italic py-1">لا يوجد حالياً</span>
                                           )}
                                        </div>
                                     </div>

                                     {/* Support (C) */}
                                     <div>
                                        <div className="flex items-center gap-2 mb-3">
                                           <div className="w-1.5 h-4 bg-indigo-500 rounded-full"></div>
                                           <span className="font-black text-[11px] text-slate-800 uppercase tracking-tight">دعم وقائي وتمكين (C)</span>
                                           <span className="text-[10px] font-bold text-slate-400 mr-auto">{cs.C.length} تلاميذ</span>
                                        </div>
                                        <div className="flex flex-wrap gap-1.5">
                                           {cs.C.length > 0 ? cs.C.map((name, idx) => (
                                              <span key={idx} className="bg-indigo-50/50 text-indigo-800 px-3 py-1.5 rounded-lg text-[10px] font-bold border border-indigo-100/50 hover:bg-indigo-100 transition-colors cursor-default">
                                                 {name}
                                              </span>
                                           )) : (
                                              <span className="text-[10px] font-bold text-slate-300 italic py-1">لا يوجد حالياً</span>
                                           )}
                                        </div>
                                     </div>
                                  </div>

                                  <div className="px-8 py-4 bg-slate-50 border-t border-slate-100 flex items-center justify-between">
                                     <div className="flex items-center gap-2 text-[9px] font-black text-slate-400">
                                        <BrainCircuit size={14} className="text-amber-500" />
                                        <span>توصية ISA2: بيداغوجيا المشروع</span>
                                     </div>
                                     <div className="text-[9px] font-black text-slate-900">
                                        تغطية {total} متعلم(ة)
                                     </div>
                                  </div>
                               </motion.div>
                            )
                         })}
                    </div>

                    {/* PDF Generation Section (Hidden) */}
                    <div className="hidden">
                      <div ref={reportAreaRef} style={{ width: '794px', backgroundColor: '#ffffff', padding: '60px', fontFamily: 'Cairo, sans-serif', boxSizing: 'border-box' }} dir="rtl" className="mx-auto shadow-sm border border-slate-100 rounded-[2rem]">
                        <div className="text-center" style={{ marginBottom: '50px', paddingBottom: '30px', borderBottom: '3px solid #0f172a' }}>
                        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '30px' }}>
                           <div style={{ textAlign: 'right' }}>
                              <p style={{ margin: '2px 0', fontSize: '14px', fontWeight: 'bold' }}>المملكة المغربية</p>
                              <p style={{ margin: '2px 0', fontSize: '12px' }}>وزارة التربية الوطنية والتعليم الأولي والرياضة</p>
                           </div>
                           <div style={{ textAlign: 'center' }}>
                             <AlertTriangle size={50} style={{ color: '#d97706' }} />
                           </div>
                           <div style={{ textAlign: 'left' }}>
                              <p style={{ margin: '2px 0', fontSize: '12px', fontWeight: 'bold' }}>ISA2 ANALYTICS</p>
                              <p style={{ margin: '2px 0', fontSize: '10px' }}>Ref: SUPPORT-REPORT-2026</p>
                           </div>
                        </div>
                        
                        <h2 style={{ fontSize: '36px', fontWeight: '900', color: '#0f172a', margin: '20px 0' }}>تقرير تشخيص المتعثرين ودعم التحصيل</h2>
                        
                        <div style={{ display: 'flex', justifyContent: 'center', gap: '20px', fontSize: '14px', color: '#334155', fontWeight: 'bold', backgroundColor: '#f8fafc', padding: '15px', borderRadius: '15px', marginTop: '20px' }}>
                          <span>المادة: {teacherInfo?.subject}</span>
                          <span style={{ color: '#cbd5e1' }}>|</span>
                          <span>القسم: {teacherInfo?.className}</span>
                          <span style={{ color: '#cbd5e1' }}>|</span>
                          <span>المرحلة: {teacherInfo?.stage}</span>
                        </div>
                      </div>
                      
                      <div style={{ borderRadius: '15px', border: '2px solid #0f172a', overflow: 'hidden' }}>
                        <table style={{ width: '100%', borderCollapse: 'collapse', backgroundColor: '#ffffff' }}>
                          <thead>
                            <tr style={{ backgroundColor: '#0f172a', color: '#ffffff' }}>
                              <th style={{ padding: '15px', textAlign: 'right', borderLeft: '1px solid #1e293b', width: '25%' }}>المعيار / الكفاية</th>
                              <th style={{ padding: '15px', textAlign: 'right', borderLeft: '1px solid #1e293b', backgroundColor: '#212c3d' }}>الفئة (C) - دعم وقائي</th>
                              <th style={{ padding: '15px', textAlign: 'right', backgroundColor: '#18212f' }}>الفئة (D) - تدخل علاجي</th>
                            </tr>
                          </thead>
                          <tbody>
                            {compStats.map((cs, idx) => (
                              <tr key={idx} style={{ borderBottom: '1px solid #e2e8f0' }}>
                                <td style={{ padding: '20px', fontWeight: 'bold', backgroundColor: '#f8fafc', textAlign: 'center', color: '#0f172a' }}>
                                  <div style={{ border: '1px solid #0f172a', padding: '5px 10px', borderRadius: '8px', display: 'inline-block' }}>{cs.code}</div>
                                </td>
                                <td style={{ padding: '20px', borderLeft: '1px solid #e2e8f0' }}>
                                  <div style={{ display: 'flex', flexWrap: 'wrap', gap: '8px' }}>
                                    {cs.C.length > 0 ? cs.C.map((n, i) => (
                                      <span key={i} style={{ color: '#0f172a', backgroundColor: '#fff', border: '1px solid #e2e8f0', borderRadius: '6px', fontSize: '11px', fontWeight: '700', padding: '4px 8px' }}>
                                        {n}
                                      </span>
                                    )) : <span style={{ color: '#94a3b8', fontStyle: 'italic', fontSize: '11px' }}>-</span>}
                                  </div>
                                </td>
                                <td style={{ padding: '20px' }}>
                                  <div style={{ display: 'flex', flexWrap: 'wrap', gap: '8px' }}>
                                    {cs.D.length > 0 ? cs.D.map((n, i) => (
                                      <span key={i} style={{ color: '#991b1b', backgroundColor: '#fef2f2', border: '1px solid #fee2e2', borderRadius: '6px', fontSize: '11px', fontWeight: '700', padding: '4px 8px' }}>
                                        {n}
                                      </span>
                                    )) : <span style={{ color: '#94a3b8', fontStyle: 'italic', fontSize: '11px' }}>-</span>}
                                  </div>
                                </td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      </div>

                      <div style={{ marginTop: '50px', display: 'flex', justifyContent: 'space-between' }}>
                        <div style={{ textAlign: 'center', width: '200px' }}>
                           <p style={{ fontWeight: 'bold', marginBottom: '40px' }}>توقيع السيد المدير</p>
                           <div style={{ borderBottom: '1px solid #000' }}></div>
                        </div>
                        <div style={{ textAlign: 'center', width: '200px' }}>
                           <p style={{ fontWeight: 'bold', marginBottom: '40px' }}>توقيع السيدة المفتشة</p>
                           <div style={{ borderBottom: '1px solid #000' }}></div>
                        </div>
                        <div style={{ textAlign: 'center', width: '200px' }}>
                           <p style={{ fontWeight: 'bold', marginBottom: '40px' }}>إمضاء الأستاذ(ة)</p>
                           <div style={{ borderBottom: '1px solid #000' }}></div>
                        </div>
                      </div>

                      <div style={{ marginTop: '40px', textAlign: 'center', color: '#94a3b8', fontSize: '10px', fontWeight: 'bold' }}>
                        تاريخ الاستخراج الرسمي: {new Date().toLocaleDateString('ar-MA')} | نظام ISA2 للتحليل البيداغوجي المتقدم
                      </div>
                    </div>

                    {/* Enhanced Parent Report Template */}
                    <div ref={parentReportRef} style={{ width: '794px', backgroundColor: '#ffffff', padding: '60px', fontFamily: 'Cairo, sans-serif' }} dir="rtl">
                      <div style={{ borderBottom: '3px solid #0f172a', paddingBottom: '30px', marginBottom: '40px' }}>
                         <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                            <div style={{ textAlign: 'right' }}>
                               <p style={{ margin: '2px 0', fontSize: '14px', fontWeight: 'bold' }}>المملكة المغربية</p>
                               <p style={{ margin: '2px 0', fontSize: '12px' }}>وزارة التربية الوطنية والتعليم الأولي والرياضة</p>
                            </div>
                            <div style={{ textAlign: 'center' }}>
                               <div style={{ width: '60px', height: '60px', borderRadius: '15px', backgroundColor: '#0f172a', display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#ffffff', fontWeight: '900', fontSize: '24px' }}>ISA</div>
                            </div>
                         </div>
                         <h3 style={{ textAlign: 'center', fontSize: '32px', fontWeight: '900', marginTop: '30px', color: '#0f172a' }}>تقرير المسار الدراسي للمتعلم</h3>
                      </div>

                      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '20px', backgroundColor: '#f8fafc', padding: '25px', borderRadius: '20px', marginBottom: '40px', border: '1px solid #e2e8f0' }}>
                         <div>
                            <p style={{ fontSize: '10px', fontWeight: '900', color: '#64748b', marginBottom: '5px', textTransform: 'uppercase' }}>اسم التلميذ(ة)</p>
                            <p style={{ fontSize: '18px', fontWeight: '900', color: '#0f172a' }}>{selectedStudentDetails?.name}</p>
                         </div>
                         <div>
                            <p style={{ fontSize: '10px', fontWeight: '900', color: '#64748b', marginBottom: '5px', textTransform: 'uppercase' }}>القسم</p>
                            <p style={{ fontSize: '18px', fontWeight: '900', color: '#0f172a' }}>{teacherInfo?.className}</p>
                         </div>
                         <div>
                            <p style={{ fontSize: '10px', fontWeight: '900', color: '#64748b', marginBottom: '5px', textTransform: 'uppercase' }}>المادة</p>
                            <p style={{ fontSize: '18px', fontWeight: '900', color: '#0f172a' }}>{teacherInfo?.subject}</p>
                         </div>
                         <div>
                            <p style={{ fontSize: '10px', fontWeight: '900', color: '#64748b', marginBottom: '5px', textTransform: 'uppercase' }}>المعدل العام</p>
                            <p style={{ fontSize: '18px', fontWeight: '900', color: '#059669' }}>{selectedStudentDetails?.average?.toFixed(2)} / 10</p>
                         </div>
                      </div>

                      {/* Performance Bar Chart (Horizontal) */}
                      <div style={{ marginBottom: '40px' }}>
                         <h4 style={{ fontSize: '20px', fontWeight: '900', color: '#0f172a', marginBottom: '20px', display: 'flex', alignItems: 'center', gap: '10px' }}>
                           <div style={{ width: '6px', height: '24px', backgroundColor: '#4f46e5', borderRadius: '3px' }}></div>
                           تحليل الكفايات والمكتسبات
                         </h4>
                         <div style={{ backgroundColor: '#ffffff', border: '1px solid #f1f5f9', borderRadius: '20px', padding: '20px', display: 'flex', flexDirection: 'column', gap: '15px' }}>
                            {getStudentPerformance(selectedStudentDetails).map((p, idx) => (
                               <div key={idx} style={{ display: 'flex', alignItems: 'center', gap: '20px' }}>
                                  <div style={{ width: '120px', fontSize: '12px', fontWeight: '800', color: '#334155' }}> الكفاية {p.subject}</div>
                                  <div style={{ flex: 1, height: '14px', backgroundColor: '#f1f5f9', borderRadius: '7px', overflow: 'hidden', position: 'relative' }}>
                                     <div style={{ width: `${p.score}%`, height: '100%', backgroundColor: p.val >= 8 ? '#10b981' : p.val >= 6 ? '#2dd4bf' : p.val >= 4 ? '#fbbf24' : '#f43f5e', borderRadius: '7px' }}></div>
                                  </div>
                                  <div style={{ width: '45px', fontSize: '14px', fontWeight: '900', color: '#0f172a', textAlign: 'left' }}>{p.val.toFixed(1)}</div>
                               </div>
                            ))}
                         </div>
                         <div style={{ marginTop: '15px', display: 'flex', gap: '15px', justifyContent: 'center' }}>
                            <div style={{ display: 'flex', alignItems: 'center', gap: '5px', fontSize: '9px', fontWeight: '900', color: '#64748b' }}>
                               <div style={{ width: '8px', height: '8px', backgroundColor: '#10b981', borderRadius: '2px' }}></div> متميز
                            </div>
                            <div style={{ display: 'flex', alignItems: 'center', gap: '5px', fontSize: '9px', fontWeight: '900', color: '#64748b' }}>
                               <div style={{ width: '8px', height: '8px', backgroundColor: '#fbbf24', borderRadius: '2px' }}></div> متوسط
                            </div>
                            <div style={{ display: 'flex', alignItems: 'center', gap: '5px', fontSize: '9px', fontWeight: '900', color: '#64748b' }}>
                               <div style={{ width: '8px', height: '8px', backgroundColor: '#f43f5e', borderRadius: '2px' }}></div> متعثر
                            </div>
                         </div>
                      </div>

                      <div style={{ backgroundColor: '#fff', border: '2px solid #f1f5f9', borderRadius: '25px', padding: '35px', position: 'relative' }}>
                         <div style={{ position: 'absolute', top: '-15px', right: '30px', backgroundColor: '#4f46e5', color: '#fff', padding: '5px 15px', borderRadius: '10px', fontSize: '10px', fontWeight: '900' }}>خلاصة المستشار التربوي الذكي</div>
                         <div style={{ whiteSpace: 'pre-wrap', fontSize: '15px', color: '#334155', lineHeight: '2.0', fontWeight: '500' }}>
                            {parentReport}
                         </div>
                      </div>

                      <div style={{ marginTop: '60px', display: 'flex', justifyContent: 'space-between', padding: '0 40px' }}>
                         <div style={{ textAlign: 'center' }}>
                            <p style={{ fontWeight: '900', color: '#0f172a', marginBottom: '50px' }}>توقيع ولي الأمر</p>
                            <div style={{ width: '150px', borderBottom: '1px solid #e2e8f0' }}></div>
                         </div>
                         <div style={{ textAlign: 'center' }}>
                            <p style={{ fontWeight: '900', color: '#0f172a', marginBottom: '50px' }}>ختم المؤسسة</p>
                            <div style={{ width: '150px', borderBottom: '1px solid #e2e8f0' }}></div>
                         </div>
                         <div style={{ textAlign: 'center' }}>
                            <p style={{ fontWeight: '900', color: '#0f172a', marginBottom: '50px' }}>إمضاء الأستاذ(ة)</p>
                            <div style={{ width: '150px', borderBottom: '1px solid #e2e8f0' }}></div>
                         </div>
                      </div>
                      
                      <div style={{ marginTop: '50px', textAlign: 'center', borderTop: '1px solid #f1f5f9', paddingTop: '20px' }}>
                         <p style={{ fontSize: '10px', color: '#94a3b8', fontWeight: 'bold' }}>نظام ISA2 - تم استخراج التقرير بتاريخ: {new Date().toLocaleDateString('ar-MA')}</p>
                      </div>
                    </div>
                  </div>
                </div>
              )}

                {/* UI Improvement for AI Analysis Modal */}
                {activeModal === 'ai' && (
                  <div className="space-y-10 max-w-5xl mx-auto">
                    <div className="flex flex-col md:flex-row items-center gap-8 bg-gradient-to-br from-slate-900 to-slate-800 p-12 rounded-[3.5rem] text-white shadow-2xl relative overflow-hidden">
                      <div className="absolute top-0 right-0 w-96 h-96 bg-emerald-500/10 blur-[100px] rounded-full"></div>
                      <div className="relative z-10 flex-1 text-center md:text-right">
                        <div className="inline-flex items-center gap-2 bg-emerald-500/20 text-emerald-400 px-4 py-2 rounded-full text-xs font-black uppercase tracking-widest mb-6 border border-emerald-500/20">
                          <BrainCircuit size={14} />
                          نظام الذكاء الاصطناعي البيداغوجي
                        </div>
                        <h4 className="text-5xl font-black mb-4 leading-tight">التقرير التحليلي المعمق</h4>
                        <p className="text-slate-400 text-lg font-medium leading-relaxed max-w-xl">
                          رؤية بيداغوجية مدعومة بالبيانات لتحسين جودة التعلم وتجاوز صعوبات التحصيل الدراسي.
                        </p>
                      </div>
                      <div className="relative z-10 flex flex-col items-center gap-4 bg-white/5 p-8 rounded-[3rem] border border-white/10 backdrop-blur-xl">
                         <div className="w-24 h-24 rounded-full border-4 border-emerald-500 flex items-center justify-center text-3xl font-black text-emerald-500 shadow-inner">
                           {isaStats?.isaValue || '0'}
                         </div>
                         <div className="text-center">
                           <div className="text-[10px] font-black text-slate-400 uppercase tracking-widest mb-1">المؤشر العام</div>
                           <div className="text-sm font-black text-emerald-400">ISA2 SCORE</div>
                         </div>
                      </div>
                    </div>

                    <div className="grid grid-cols-1 lg:grid-cols-12 gap-8">
                       <div className="lg:col-span-5 bg-white p-10 rounded-[3rem] border-2 border-slate-50 shadow-sm flex flex-col items-center">
                          <h5 className="text-[12px] font-black text-slate-400 uppercase tracking-widest mb-10 border-b-2 border-indigo-500 pb-2">خريطة توازن الكفايات</h5>
                          <div className="w-full h-[350px]">
                            <ResponsiveContainer width="100%" height="100%">
                              <RadarChart cx="50%" cy="50%" outerRadius="80%" data={radarData}>
                                <PolarGrid stroke="#f1f5f9" />
                                <PolarAngleAxis 
                                  dataKey="subject" 
                                  tick={{ fill: '#64748b', fontSize: 10, fontWeight: 900 }} 
                                />
                                <PolarRadiusAxis angle={30} domain={[0, 100]} hide />
                                <Radar
                                  name="Health"
                                  dataKey="score"
                                  stroke="#6366f1"
                                  fill="#6366f1"
                                  fillOpacity={0.5}
                                />
                                <Tooltip />
                              </RadarChart>
                            </ResponsiveContainer>
                          </div>
                          <p className="text-[10px] font-bold text-slate-400 text-center mt-6 leading-relaxed">توضح هذه الخطاطة مدى تمكن القسم من الكفايات المختلفة، حيث تشير المساحة الأكبر إلى نضج بيداغوجي أعلى.</p>
                       </div>

                       <div className="lg:col-span-7">
                        {isGeneratingAi ? (
                          <div className="bg-slate-50 p-20 rounded-[3rem] border-2 border-dashed border-slate-200 flex flex-col items-center gap-10">
                            <div className="relative">
                              <div className="w-24 h-24 border-4 border-emerald-100 border-t-emerald-500 rounded-full animate-spin"></div>
                              <BrainCircuit size={40} className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 text-emerald-500 animate-pulse" />
                            </div>
                            <div className="text-center">
                              <p className="text-slate-900 font-black text-2xl mb-2">جاري المعالجة...</p>
                              <p className="text-slate-400 font-medium">نحن نصيغ لك الآن تقريراً بيداغوجياً استثنائياً للقسم</p>
                            </div>
                          </div>
                        ) : (
                          <motion.div 
                            initial={{ opacity: 0, y: 10 }}
                            animate={{ opacity: 1, y: 0 }}
                            className="bg-white p-12 rounded-[3.5rem] border-2 border-slate-50 shadow-xl text-slate-800 leading-relaxed font-medium overflow-y-auto max-h-[70vh] custom-scrollbar"
                          >
                            <div className="prose prose-slate prose-lg max-w-none rtl">
                              {aiReport ? aiReport.split('\n').map((line, i) => {
                                if (line.startsWith('#')) return <h3 key={i} className="text-2xl font-black text-slate-900 mt-10 mb-4 flex items-center gap-3"><div className="w-2 h-8 bg-emerald-500 rounded-full"></div>{line.replace(/#/g, '').trim()}</h3>;
                                if (line.trim().startsWith('-')) return <li key={i} className="mr-6 mb-3 text-slate-700 font-bold bg-slate-50 p-4 rounded-2xl border border-slate-100 list-none flex items-center gap-4"><div className="w-2 h-2 bg-indigo-500 rounded-full shrink-0"></div>{line.replace('-', '').trim()}</li>;
                                if (line.trim() === '') return <div key={i} className="h-4" />;
                                return <p key={i} className="mb-6 text-slate-600 leading-loose text-lg">{line}</p>;
                              }) : (
                                <div className="text-center py-20">
                                  <AlertTriangle size={48} className="text-slate-200 mx-auto mb-6" />
                                  <p className="text-xl font-black text-slate-300">لم يتم توليد التقرير بعد.</p>
                                </div>
                              )}
                            </div>
                          </motion.div>
                        )}
                       </div>
                    </div>
                  </div>
                )}

                {activeModal === 'honor' && (
                  <div className="space-y-12 max-w-5xl mx-auto">
                    {/* Header Section */}
                    <div className="relative overflow-hidden bg-gradient-to-br from-indigo-900 via-slate-900 to-indigo-950 p-12 rounded-[3.5rem] text-white shadow-2xl">
                       <div className="absolute top-0 right-0 w-96 h-96 bg-amber-500/10 blur-[100px] rounded-full translate-x-1/2 -translate-y-1/2"></div>
                       <div className="absolute bottom-0 left-0 w-64 h-64 bg-indigo-500/10 blur-[80px] rounded-full -translate-x-1/3 translate-y-1/3"></div>
                       
                       <div className="relative z-10 flex flex-col items-center text-center">
                          <motion.div 
                            initial={{ scale: 0, rotate: -20 }}
                            animate={{ scale: 1, rotate: 0 }}
                            className="bg-gradient-to-tr from-amber-400 to-amber-200 p-6 rounded-[2.5rem] shadow-2xl shadow-amber-500/20 mb-8"
                          >
                            <Trophy size={48} className="text-amber-900" />
                          </motion.div>
                          <h2 className="text-5xl font-black mb-4 tracking-tight">نخبة التميز الدراسي</h2>
                          <p className="text-indigo-200/70 text-lg font-medium max-w-2xl leading-relaxed">
                            تكريم خاص للتلاميذ الذين برهنوا على تمكن استثنائي (مستوى A) في جميع الكفايات المرصودة لهذه المرحلة.
                          </p>
                       </div>
                    </div>
                    
                    {/* Elite Grid */}
                    <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
                      {eliteStudents.length > 0 ? eliteStudents.map((st, i) => (
                        <motion.div 
                          key={i}
                          initial={{ opacity: 0, y: 30 }}
                          animate={{ opacity: 1, y: 0 }}
                          transition={{ delay: i * 0.1 }}
                          className="group relative bg-white border border-slate-100 rounded-[2.5rem] p-8 shadow-sm hover:shadow-2xl transition-all hover:-translate-y-2 overflow-hidden"
                        >
                           {/* Background Decoration */}
                           <div className="absolute top-0 right-0 w-32 h-32 bg-amber-50 rounded-bl-full -mr-10 -mt-10 group-hover:bg-amber-100 transition-colors"></div>
                           
                           <div className="relative z-10">
                              <div className="flex items-start justify-between mb-6">
                                 <div className="w-16 h-16 bg-slate-900 rounded-2xl flex items-center justify-center text-white text-2xl font-black shadow-lg">
                                    {st.name.charAt(0)}
                                 </div>
                                 <div className="bg-amber-100 text-amber-700 px-3 py-1 rounded-full text-[10px] font-black uppercase tracking-tight flex items-center gap-1.5 border border-amber-200">
                                    <Star size={10} fill="currentColor" />
                                    Elite Member
                                 </div>
                              </div>
                              
                              <h3 className="text-xl font-black text-slate-800 mb-2 truncate">{st.name}</h3>
                              <p className="text-slate-400 text-xs font-bold mb-8 flex items-center gap-2">
                                <GraduationCap size={14} className="text-indigo-500" />
                                {teacherInfo?.className} • متميز (A)
                              </p>

                              <div className="flex gap-3">
                                 <button 
                                   onClick={() => {
                                     setSelectedStudentDetails(st);
                                     setParentReport('');
                                   }}
                                   className="flex-1 bg-slate-50 hover:bg-slate-100 text-slate-600 py-3 rounded-xl font-black text-[10px] transition-all border border-slate-100"
                                 >
                                    تحليل الملف
                                 </button>
                                 <button 
                                   onClick={() => generateSingleCertificate(st)}
                                   className="flex-1 bg-amber-400 hover:bg-slate-900 hover:text-white text-amber-900 py-3 rounded-xl font-black text-[10px] transition-all shadow-md shadow-amber-200 flex items-center justify-center gap-2"
                                 >
                                    <Download size={14} />
                                    الشهادة
                                 </button>
                              </div>
                           </div>
                        </motion.div>
                      )) : (
                        <div className="col-span-full py-24 flex flex-col items-center justify-center bg-slate-50 rounded-[3.5rem] border-2 border-dashed border-slate-200">
                           <div className="w-20 h-20 bg-white rounded-full flex items-center justify-center text-slate-200 shadow-inner mb-6">
                              <Trophy size={40} />
                           </div>
                           <p className="text-slate-400 font-black text-lg">لم يتم العثور على متعلمين حققوا العلامة الكاملة حالياً.</p>
                           <p className="text-slate-300 font-bold text-sm mt-2 font-mono">Status: Awaiting Academic Excellence</p>
                        </div>
                      )}
                    </div>

                    {/* Action Bar */}
                    {eliteStudents.length > 0 && (
                      <div className="flex flex-col md:flex-row items-center justify-center gap-6 pt-10">
                         <button 
                           onClick={generateCertificates}
                           className="bg-indigo-600 hover:bg-slate-900 text-white px-10 py-4 rounded-2xl font-black text-sm flex items-center gap-3 transition-all shadow-xl shadow-indigo-200 active:scale-95"
                         >
                           <Printer size={20} />
                           استخراج جميع الشواهد التقديرية (PDF)
                         </button>
                         {downloadStatus && (
                           <motion.div 
                             initial={{ opacity: 0, x: -20 }}
                             animate={{ opacity: 1, x: 0 }}
                             className="bg-emerald-50 text-emerald-700 px-6 py-4 rounded-2xl font-black text-xs border border-emerald-100 flex items-center gap-2"
                           >
                             <CheckCircle2 size={16} />
                             {downloadStatus}
                           </motion.div>
                         )}
                      </div>
                    )}
                  </div>
                )}
              </div>
            </motion.div>
          </div>
        )}
      </AnimatePresence>

      <AnimatePresence>
        {selectedStudentDetails && (
          <div className="fixed inset-0 z-[100] flex items-center justify-center p-4 backdrop-blur-3xl bg-slate-900/60 transition-all">
            <motion.div 
              initial={{ scale: 0.9, opacity: 0, y: 20 }}
              animate={{ scale: 1, opacity: 1, y: 0 }}
              exit={{ scale: 0.9, opacity: 0, y: 20 }}
              className="bg-white w-full max-w-4xl max-h-[90vh] rounded-[3rem] overflow-hidden shadow-2xl flex flex-col relative"
            >
              <button 
                onClick={() => setSelectedStudentDetails(null)}
                className="absolute left-6 top-6 z-10 w-12 h-12 bg-slate-100 rounded-full flex items-center justify-center text-slate-800 hover:bg-rose-500 hover:text-white transition-all shadow-sm"
              >
                <X size={24} />
              </button>

              <div className="overflow-y-auto custom-scrollbar">
                <div className="relative h-48 bg-slate-900 flex items-end p-10 overflow-hidden">
                   <div className="absolute top-0 left-0 w-full h-full bg-[radial-gradient(circle_at_20%_20%,#4f46e5_0%,#0f172a_100%)] opacity-40"></div>
                   <div className="relative z-10 flex items-center gap-6">
                      <div className="w-24 h-24 bg-white rounded-3xl shadow-xl flex items-center justify-center text-4xl font-black text-indigo-600 border-4 border-indigo-500/20">
                        {selectedStudentDetails.name.charAt(0)}
                      </div>
                      <div className="text-white">
                        <h2 className="text-4xl font-black mb-2">{selectedStudentDetails.name}</h2>
                        <div className="flex gap-4">
                          <span className="bg-indigo-500/30 text-indigo-200 px-4 py-1 rounded-full text-xs font-black uppercase border border-indigo-400/20">تلميذ(ة)</span>
                          <span className="bg-white/10 text-slate-200 px-4 py-1 rounded-full text-xs font-black uppercase border border-white/10">{teacherInfo?.className}</span>
                        </div>
                      </div>
                   </div>
                </div>

                <div className="p-10">
                  <div className="grid grid-cols-1 lg:grid-cols-2 gap-10">
                     {/* Left: Individual Radar Chart */}
                     <div className="bg-slate-50 p-8 rounded-[2.5rem] border border-slate-100 flex flex-col items-center">
                        <h4 className="text-[10px] font-black text-slate-400 uppercase tracking-widest mb-8 border-b-2 border-indigo-500 pb-2">رادار الأداء الفردي</h4>
                        <div className="w-full h-[300px]">
                          <ResponsiveContainer width="100%" height="100%">
                            <RadarChart cx="50%" cy="50%" outerRadius="80%" data={getStudentPerformance(selectedStudentDetails)}>
                              <PolarGrid stroke="#e2e8f0" />
                              <PolarAngleAxis 
                                dataKey="subject" 
                                tick={{ fill: '#64748b', fontSize: 10, fontWeight: 900 }} 
                              />
                              <PolarRadiusAxis angle={30} domain={[0, 100]} hide />
                              <Radar
                                name="متوسط القسم"
                                dataKey="classAvg"
                                stroke="#0f172a"
                                fill="#0f172a"
                                fillOpacity={0.1}
                              />
                              <Radar
                                name={selectedStudentDetails.name}
                                dataKey="score"
                                stroke="#6366f1"
                                fill="#6366f1"
                                fillOpacity={0.5}
                              />
                              <Tooltip />
                            </RadarChart>
                          </ResponsiveContainer>
                        </div>
                        <div className="flex gap-4 mt-6 text-[9px] font-black uppercase">
                           <div className="flex items-center gap-1.5"><div className="w-2 h-2 rounded-full bg-[#6366f1]"></div> التلميذ</div>
                           <div className="flex items-center gap-1.5"><div className="w-2 h-2 rounded-full bg-[#0f172a]"></div> متوسط القسم</div>
                        </div>
                        <p className="text-[10px] font-bold text-slate-400 text-center mt-6 leading-relaxed">تُظهر الخطاطة التوازنات والتباينات في تمكن التلميذ(ة) مقارنة بمتوسط القسم.</p>
                     </div>

                     {/* Right: Parent Report and Strategy */}
                     <div className="flex flex-col h-full space-y-6">
                        {/* AI Support Strategy inside full-screen Modal */}
                        <div className="bg-emerald-50/50 border border-emerald-100 rounded-[2rem] p-6 relative overflow-hidden">
                            <div className="absolute -top-4 -right-4 w-24 h-24 bg-emerald-500/5 blur-2xl rounded-full"></div>
                            <div className="flex justify-between items-center mb-4">
                               <h6 className="text-xs font-black text-emerald-800 flex items-center gap-2">
                                  <BrainCircuit size={16} />
                                  خطة الدعم المقترحة (للمدرس)
                               </h6>
                               {!studentStrategy && !isGeneratingStrategy && (
                                 <button 
                                   onClick={() => generateStudentStrategy(selectedStudentDetails)}
                                   className="text-[9px] font-black bg-white text-emerald-600 px-3 py-1 rounded-lg border border-emerald-200 hover:bg-emerald-500 hover:text-white transition-all shadow-sm"
                                 >
                                   استخلاص الخطة
                                 </button>
                               )}
                            </div>
                            
                            {isGeneratingStrategy ? (
                               <div className="flex items-center gap-3 animate-pulse py-4">
                                  <div className="w-2 h-2 bg-emerald-500 rounded-full"></div>
                                  <span className="text-[10px] font-black text-emerald-600">جاري التفكير البيداغوجي...</span>
                               </div>
                            ) : studentStrategy ? (
                               <div className="text-[11px] font-bold text-emerald-700 space-y-2 leading-relaxed">
                                  {studentStrategy.split('\n').map((l, i) => <p key={i}>{l}</p>)}
                               </div>
                            ) : (
                               <p className="text-[10px] font-bold text-slate-400 italic">اضغط زر "استخلاص" للحصول على توصيات بيداغوجية مخصصة</p>
                            )}
                        </div>

                        <div className="flex-1 bg-white rounded-[2.5rem] border border-slate-100 p-8 shadow-sm relative min-h-[300px]">
                          {isGeneratingParentReport ? (
                            <div className="absolute inset-0 flex flex-col items-center justify-center p-10 bg-white/40 backdrop-blur-sm z-10">
                               <motion.div animate={{ rotate: 360 }} transition={{ repeat: Infinity, duration: 2, ease: "linear" }}>
                                  <Sparkles size={40} className="text-indigo-500" />
                               </motion.div>
                               <p className="mt-4 text-slate-900 font-black">جاري صياغة التقرير التربوي...</p>
                            </div>
                          ) : null}

                          {parentReport ? (
                            <div className="prose prose-slate prose-sm max-w-none rtl">
                               {parentReport.split('\n').map((l, i) => (
                                 <p key={i} className="mb-3 text-slate-700 font-medium leading-relaxed">{l}</p>
                               ))}
                            </div>
                          ) : (
                            <div className="h-full flex flex-col items-center justify-center text-center p-10 space-y-6">
                               <div className="w-16 h-16 bg-white rounded-full flex items-center justify-center text-slate-200 shadow-inner">
                                  <ScrollText size={32} />
                               </div>
                               <p className="text-slate-400 font-bold max-w-xs capitalize">أصدر تقريراً تربوياً ذكياً باللغة العربية الفصحى لمشاركته مع ولي الأمر</p>
                               <button 
                                 onClick={() => generateParentReport(selectedStudentDetails)}
                                 className="bg-indigo-500 hover:bg-slate-900 text-white px-8 py-4 rounded-2xl font-black shadow-xl shadow-indigo-500/20 transition-all active:scale-95"
                               >
                                 توليد التقرير الآن
                               </button>
                            </div>
                          )}
                        </div>

                        {parentReport && (
                          <div className="mt-6 flex flex-col sm:flex-row gap-4">
                            <button 
                              onClick={() => {
                                navigator.clipboard.writeText(parentReport);
                                alert('تم نسخ التقرير بنجاح!');
                              }}
                              className="flex-1 bg-slate-900 shadow-xl shadow-slate-900/20 text-white py-4 rounded-2xl font-black hover:bg-slate-800 transition-all flex items-center justify-center gap-2 group"
                            >
                              <Copy size={18} className="group-hover:scale-110 transition-transform" />
                              نسخ التقرير
                            </button>
                            
                            <button 
                              onClick={downloadParentReportPDF}
                              className="flex-1 bg-indigo-600 shadow-xl shadow-indigo-600/20 text-white py-4 rounded-2xl font-black hover:bg-indigo-700 transition-all flex items-center justify-center gap-2 group"
                            >
                              <Download size={18} className="group-hover:translate-y-0.5 transition-transform" />
                              تصدير PDF المطور
                            </button>

                            <button 
                              onClick={() => generateParentReport(selectedStudentDetails)}
                              className="w-14 h-14 bg-slate-100 text-slate-500 rounded-2xl flex items-center justify-center hover:bg-indigo-50 hover:text-indigo-600 transition-all shrink-0"
                              title="إعادة التوليد"
                            >
                              <RefreshCw size={20} />
                            </button>
                          </div>
                        )}
                     </div>
                  </div>
                </div>
              </div>
            </motion.div>
          </div>
        )}
      </AnimatePresence>

      {/* Bug Report Section */}
      <section className="mt-20 max-w-4xl mx-auto">
        <div className="bg-white rounded-[2.5rem] p-8 md:p-12 border border-slate-100 shadow-sm relative overflow-hidden group">
          <div className="absolute top-0 right-0 w-64 h-64 bg-rose-50 rounded-full blur-[80px] -mr-32 -mt-32 transition-colors group-hover:bg-rose-100/50"></div>
          
          <div className="relative z-10 flex flex-col md:flex-row gap-10 items-center">
            <div className="flex-1 space-y-3">
              <div className="flex items-center gap-3">
                <div className="w-10 h-10 bg-rose-50 text-rose-500 rounded-xl flex items-center justify-center">
                  <MessageSquareWarning size={20} />
                </div>
                <h3 className="text-xl font-black text-slate-800">هل واجهت مشكلة؟</h3>
              </div>
              <p className="text-slate-500 font-bold leading-relaxed text-sm">
                إذا لاحظت أي خطأ في الحسابات أو مشكلة في الواجهة، لا تتردد في مراسلتنا.
              </p>
            </div>
            
            <div className="w-full md:w-80">
              {bugReportStatus === 'success' ? (
                <motion.div 
                  initial={{ scale: 0.9, opacity: 0 }}
                  animate={{ scale: 1, opacity: 1 }}
                  className="bg-emerald-50 border border-emerald-100 p-6 rounded-2xl text-center"
                >
                  <div className="w-10 h-10 bg-emerald-500 text-white rounded-full flex items-center justify-center mx-auto mb-3">
                    <CheckCircle2 size={20} />
                  </div>
                  <p className="text-emerald-800 font-bold text-xs">تم إرسال بلاغك بنجاح!</p>
                </motion.div>
              ) : (
                <form onSubmit={submitBugReport} className="space-y-3">
                  <textarea 
                    value={bugMessage}
                    onChange={(e) => setBugMessage(e.target.value)}
                    placeholder="اشرح المشكلة باختصار هنا..."
                    className="w-full bg-slate-50 border-2 border-slate-100 rounded-xl p-4 text-xs font-bold min-h-[100px] focus:outline-none focus:border-rose-500 transition-all text-slate-800"
                    required
                  ></textarea>
                  <button 
                    type="submit"
                    disabled={bugReportStatus === 'sending'}
                    className="w-full bg-slate-900 hover:bg-rose-500 text-white py-3 rounded-xl font-black flex items-center justify-center gap-2 transition-all active:scale-95 disabled:opacity-50 text-xs"
                  >
                    {bugReportStatus === 'sending' ? 'جاري الإرسال...' : (
                      <>
                        إرسال البلاغ
                        <Send size={14} />
                      </>
                    )}
                  </button>
                </form>
              )}
            </div>
          </div>
        </div>
      </section>

      <footer className="mt-24 text-center text-slate-400 text-[10px] font-black uppercase tracking-widest pb-12 opacity-60">
        <p>© {new Date().getFullYear()} ISA Integrated System • Version 2.0.0 (Corrected Edition)</p>
      </footer>
    </div>
  );
}
