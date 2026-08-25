using System;
using System.IO;
using System.Text;
using System.Collections.Generic;
using System.Net;               
using System.Threading.Tasks;   
using System.Text.RegularExpressions; 

class Program
{
    // --- 1. CAU HINH ---
    static string wikiApiVi = "https://vi.wikipedia.org/api/rest_v1/page/random/summary";
    static string wikiApiEn = "https://en.wikipedia.org/api/rest_v1/page/random/summary";
    
    // Ten file offline can doc (nam cung thu muc voi tool)
    static string localFileName = "noidung.txt"; 

    // --- 2. HEADER ---
    static string[] titleAdjectives = { "STRATEGIC", "INTERNAL", "GLOBAL", "CONFIDENTIAL", "ANNUAL", "QUARTERLY", "TECHNICAL", "OFFICIAL" };
    static string[] titleTopics = { "FINANCIAL", "CYBERSECURITY", "OPERATIONAL", "MARKETING", "HR POLICY", "LEGAL", "NETWORK", "CLOUD" };
    static string[] titleNouns = { "REPORT", "ANALYSIS", "MEMO", "STATEMENT", "GUIDELINES", "FRAMEWORK", "REVIEW", "AUDIT" };

    static List<string> dynamicContent = new List<string>();

    static void Main(string[] args)
    {
        MainAsync(args).Wait();
    }

    static async Task MainAsync(string[] args)
    {
        Console.Title = "Tool Tao PDF - Wiki & Offline Text";
        Console.OutputEncoding = Encoding.UTF8; 
        Console.WriteLine("=== TOOL TAO FILE PDF NGAU NHIEN ===");

        try {
            ServicePointManager.SecurityProtocol = SecurityProtocolType.Tls12 | SecurityProtocolType.Tls11 | SecurityProtocolType.Tls;
        } catch { }

        int soLuongFile = 1;
        int soTrangMoiFile = 1;
        int soLuongDoanVanCanLay = 5; 

        // --- NHAP LIEU ---
        try
        {
            Console.Write("[-] Nhap so luong file ban muon tao: ");
            string fInput = Console.ReadLine();
            if (!string.IsNullOrEmpty(fInput)) soLuongFile = int.Parse(fInput);

            Console.Write("[-] Nhap so luong trang cho moi file: ");
            string pInput = Console.ReadLine();
            if (!string.IsNullOrEmpty(pInput)) soTrangMoiFile = int.Parse(pInput);
            
            Console.Write("[-] So doan van muon lay: ");
            string wInput = Console.ReadLine();
            if (!string.IsNullOrEmpty(wInput)) soLuongDoanVanCanLay = int.Parse(wInput);
        }
        catch 
        {
            Console.WriteLine("(!) Loi nhap lieu. Dung mac dinh.");
        }

        // --- BUOC 1: THU TAI TU INTERNET ---
        Console.WriteLine(string.Format("\nDang thu tai {0} doan noi dung tu Wikipedia...", soLuongDoanVanCanLay));
        
        for (int k = 0; k < soLuongDoanVanCanLay; k++)
        {
            string url = (k % 2 == 0) ? wikiApiVi : wikiApiEn;
            string rawText = await FetchWikiContent(url);
            
            if (!string.IsNullOrEmpty(rawText))
            {
                string cleanText = ConvertToUnSign(rawText);
                dynamicContent.Add(cleanText);
                string preview = cleanText.Length > 40 ? cleanText.Substring(0, 40) : cleanText;
                Console.WriteLine(string.Format(" [Online] {0}...", preview));
            }
        }

        // --- BUOC 2: NEU KHONG CO MANG, DOC FILE TXT ---
        if (dynamicContent.Count == 0)
        {
            Console.WriteLine("\n(!) Khong ket noi duoc Wiki. Dang tim file: " + localFileName);
            
            if (File.Exists(localFileName))
            {
                try
                {
                    // Doc file txt (UTF-8)
                    string[] lines = File.ReadAllLines(localFileName, Encoding.UTF8);
                    
                    int count = 0;
                    foreach (string line in lines)
                    {
                        if (!string.IsNullOrWhiteSpace(line))
                        {
                            string cleanText = ConvertToUnSign(line);
                            dynamicContent.Add(cleanText);
                            count++;
                            // Neu lay du so luong yeu cau thi dung lai (hoac lay het neu muon)
                            if (count >= soLuongDoanVanCanLay * 2) break; 
                        }
                    }
                    Console.WriteLine(string.Format(" [Offline] Da doc {0} dong tu file {1}", count, localFileName));
                }
                catch (Exception ex)
                {
                    Console.WriteLine(" [Loi File] " + ex.Message);
                }
            }
            else
            {
                Console.WriteLine(" (!) Khong tim thay file " + localFileName);
            }
        }

        // --- BUOC 3: NEU VAN KHONG CO DU LIEU, DUNG NOI DUNG MAU ---
        if (dynamicContent.Count == 0)
        {
            Console.WriteLine("(!) Khong co du lieu Online lan Offline. Dung noi dung mau.");
            dynamicContent.Add("Noi dung mau du phong.");
            dynamicContent.Add("Lorem ipsum dolor sit amet.");
        }

        Random rnd = new Random();
        
        string outputDir = Path.Combine(AppDomain.CurrentDomain.BaseDirectory, "PDFDaTao");
        
        if (!Directory.Exists(outputDir)) Directory.CreateDirectory(outputDir);

        Console.WriteLine("\nDang tao file PDF vao: PDFDaTao");

        for (int i = 0; i < soLuongFile; i++)
        {
            // Tao ten file tu noi dung (du la Wiki hay File Local deu dung ham nay)
            string fileName = GenerateNameFromWikiRandomPos(rnd); 
            string fullPath = Path.Combine(outputDir, fileName);
            
            int duplicateCount = 1;
            while(File.Exists(fullPath))
            {
                string tempName = fileName.Replace(".pdf", "_" + duplicateCount + ".pdf");
                fullPath = Path.Combine(outputDir, tempName);
                duplicateCount++;
            }
            
            try 
            {
                GeneratePdf(fullPath, soTrangMoiFile, rnd);
                Console.WriteLine(" [GHI FILE] " + Path.GetFileName(fullPath));
            }
            catch (Exception ex)
            {
                Console.WriteLine(" [LOI] " + ex.Message);
            }
        }
        
        Console.WriteLine("\nDA HOAN TAT! Kiem tra thu muc: PDFDaTao");
        Console.ReadKey();
    }

    static async Task<string> FetchWikiContent(string url)
    {
        try
        {
            using (WebClient wc = new WebClient())
            {
                wc.Encoding = Encoding.UTF8;
                wc.Headers.Add("User-Agent", "BotTaoPDF/1.0");
                string json = await wc.DownloadStringTaskAsync(url);
                Match match = Regex.Match(json, "\"extract\":\"(.*?)\"");
                if (match.Success) return Regex.Unescape(match.Groups[1].Value);
            }
        }
        catch { return null; }
        return null;
    }

    static string ConvertToUnSign(string s)
    {
        Regex regex = new Regex("\\p{IsCombiningDiacriticalMarks}+");
        string temp = s.Normalize(NormalizationForm.FormD);
        string unsigned = regex.Replace(temp, String.Empty).Replace('\u0111', 'd').Replace('\u0110', 'D');
        string asciiOnly = Regex.Replace(unsigned, @"[^\u0000-\u007F]+", string.Empty);
        return asciiOnly;
    }

    // --- Lay cum tu o VI TRI NGAU NHIEN trong noi dung ---
    static string GenerateNameFromWikiRandomPos(Random rnd)
    {
        if (dynamicContent.Count == 0) return "Document_" + rnd.Next(9999) + ".pdf";

        string content = dynamicContent[rnd.Next(dynamicContent.Count)];
        
        string[] words = content.Split(new char[]{' ', '.', ',', ';'}, StringSplitOptions.RemoveEmptyEntries);
        
        if (words.Length < 3) return "Doc_" + rnd.Next(99999) + ".pdf";

        int wordsToTake = rnd.Next(4, 8);
        int maxStartIndex = Math.Max(0, words.Length - wordsToTake);
        int startIndex = rnd.Next(0, maxStartIndex + 1);
        int actualTake = Math.Min(wordsToTake, words.Length - startIndex);

        string rawName = string.Join("_", words, startIndex, actualTake);
        string safeName = Regex.Replace(rawName, @"[^a-zA-Z0-9_]", "");
        
        if (safeName.Length < 5) safeName = "Doc_" + rnd.Next(9999);
        if (safeName.Length > 60) safeName = safeName.Substring(0, 60);

        return safeName + ".pdf";
    }

    static string GenerateRandomTitle(Random rnd)
    {
        string adj = titleAdjectives[rnd.Next(titleAdjectives.Length)];
        string topic = titleTopics[rnd.Next(titleTopics.Length)];
        string noun = titleNouns[rnd.Next(titleNouns.Length)];
        string year = rnd.Next(2023, 2026).ToString();
        int format = rnd.Next(3);
        if (format == 0) return adj + " " + topic + " " + noun + " " + year;
        if (format == 1) return topic + " " + noun + " - " + adj + " REVIEW";
        return noun + " OF " + topic + " (" + adj + ")";
    }

    static string GetWikiParagraph(Random rnd)
    {
        if (dynamicContent.Count == 0) return "Empty content.";
        return dynamicContent[rnd.Next(dynamicContent.Count)];
    }

    static void GeneratePdf(string filePath, int totalPages, Random rnd)
    {
        List<long> offsets = new List<long>();
        string[] fonts = { "Helvetica", "Times-Roman", "Courier" };
        string chosenFont = fonts[rnd.Next(fonts.Length)];

        using (FileStream fs = new FileStream(filePath, FileMode.Create))
        using (StreamWriter sw = new StreamWriter(fs, Encoding.ASCII))
        {
            Action<string> wLine = delegate(string s) { sw.WriteLine(s); sw.Flush(); };
            
            wLine("%PDF-1.4");
            wLine("%" + Guid.NewGuid().ToString()); 

            offsets.Add(fs.Position); wLine("1 0 obj"); wLine("<< /Type /Catalog /Pages 2 0 R >>"); wLine("endobj");
            offsets.Add(fs.Position); wLine("2 0 obj"); 
            sw.Write("<< /Type /Pages /Count " + totalPages + " /Kids [");
            for(int i=0; i<totalPages; i++) sw.Write((5 + i*2) + " 0 R "); 
            wLine("] >>"); wLine("endobj");
            offsets.Add(fs.Position); wLine("3 0 obj"); wLine("<< /Type /Font /Subtype /Type1 /Name /F1 /BaseFont /" + chosenFont + " >>"); wLine("endobj");
            offsets.Add(fs.Position); wLine("4 0 obj"); wLine("<< /Type /Font /Subtype /Type1 /Name /F2 /BaseFont /" + chosenFont + "-Bold >>"); wLine("endobj");

            for (int i = 0; i < totalPages; i++)
            {
                int pageObjId = 5 + i * 2;
                int contentObjId = pageObjId + 1;

                offsets.Add(fs.Position);
                wLine(pageObjId + " 0 obj");
                wLine("<< /Type /Page /Parent 2 0 R /MediaBox [0 0 595 842] /Resources << /Font << /F1 3 0 R /F2 4 0 R >> >> /Contents " + contentObjId + " 0 R >>");
                wLine("endobj");

                StringBuilder content = new StringBuilder();
                content.AppendLine("BT /F1 4 Tf 1 1 1 rg 10 10 Td (" + Guid.NewGuid().ToString() + ") Tj 0 g ET"); 
                int noiseCount = rnd.Next(3, 8);
                content.AppendLine("0.9 G 0.5 w"); 
                for(int n=0; n<noiseCount; n++)
                    content.AppendLine(rnd.Next(600) + " " + rnd.Next(800) + " m " + rnd.Next(600) + " " + rnd.Next(800) + " l S");
                content.AppendLine("0 G"); 

                int currentY = 780; 
                int margin = rnd.Next(40, 60);
                content.AppendLine("BT /F2 10 Tf " + margin + " 810 Td (RefID: " + rnd.Next(10000,99999) + " | Confidential) Tj ET");
                
                if (i == 0) 
                {
                    string bigTitle = GenerateRandomTitle(rnd); 
                    content.AppendLine("BT /F2 18 Tf " + margin + " " + currentY + " Td");
                    content.AppendLine("(" + bigTitle + ") Tj ET");
                    currentY -= 40;
                }

                while (currentY > 70) 
                {
                    content.AppendLine("BT /F1 11 Tf 14 TL " + margin + " " + currentY + " Td");
                    string rawText = GetWikiParagraph(rnd);
                    string[] words = rawText.Split(' ');
                    string line = "";
                    int charsPerLine = 85; 
                    foreach(string word in words)
                    {
                        if ((line + word).Length < charsPerLine) { line += word + " "; }
                        else 
                        { 
                            string safeLine = line.Replace("\\", "\\\\").Replace("(", "\\(").Replace(")", "\\)");
                            content.AppendLine("(" + safeLine + ") Tj T*"); 
                            currentY -= 14; 
                            line = word + " "; 
                        }
                        if (currentY < 60) break;
                    }
                    if (currentY > 60) 
                    { 
                        string safeLine = line.Replace("\\", "\\\\").Replace("(", "\\(").Replace(")", "\\)");
                        content.AppendLine("(" + safeLine + ") Tj"); 
                        currentY -= 24; 
                    }
                    content.AppendLine("ET");
                }
                
                content.AppendLine("BT /F1 9 Tf 280 30 Td (Page " + (i+1) + " of " + totalPages + ") Tj ET");
                string streamData = content.ToString();
                offsets.Add(fs.Position);
                wLine(contentObjId + " 0 obj");
                wLine("<< /Length " + streamData.Length + " >>");
                wLine("stream");
                wLine(streamData);
                wLine("endstream");
                wLine("endobj");
            }

            long xrefStart = fs.Position;
            wLine("xref");
            wLine("0 " + (offsets.Count + 1));
            wLine("0000000000 65535 f ");
            foreach (long off in offsets) wLine(off.ToString("D10") + " 00000 n ");
            wLine("trailer");
            wLine("<< /Size " + (offsets.Count + 1) + " /Root 1 0 R >>");
            wLine("startxref");
            wLine(xrefStart.ToString());
            wLine("%%EOF");
        }
    }
}