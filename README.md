<p align="center">
  <img src="icons/icon128.png" width="72" alt="DocUnchain icon">
</p>

<h1 align="center">DocUnchain</h1>

<p align="center">
  Xuất PDF từ tài liệu công khai hoặc được phép sử dụng trong Chrome.<br>
  Export public or authorized documents to PDF in Chrome.
</p>

<p align="center">
  <img src="https://img.shields.io/badge/Chrome-Manifest%20V3-4285F4?style=flat-square&logo=googlechrome&logoColor=white" alt="Chrome Manifest V3">
  <img src="https://img.shields.io/badge/version-1.4.1-1F8F66?style=flat-square" alt="Version 1.4.1">
  <img src="https://img.shields.io/badge/license-MIT-6B7280?style=flat-square" alt="MIT License">
</p>

## Hỗ trợ / Supported sites

| Dịch vụ / Service | Phạm vi / Scope | Luồng xuất / Export path | Lưu ý / Notes |
|---|---|---|---|
| Studocu / Studeersnel | Nội dung trình xem đã cung cấp cho phiên hiện tại / Viewer content available to the current session | Hộp thoại in của Chrome / Chrome print dialog | Nội dung máy chủ không cung cấp vẫn không thể xuất / Server-withheld content remains unavailable |
| Scribd | Trang tài liệu hoặc embed được hỗ trợ / Supported document or embed route | Luồng embed rồi in / Embed-and-print flow | Phụ thuộc vào trình xem hiện tại của Scribd / Depends on the current Scribd viewer |
| SlideShare | Bài trình bày công khai có metadata và ảnh slide khả dụng / Public presentations with available metadata and slide images | Ảnh CDN → jsPDF cục bộ / CDN images → local jsPDF | PDF dạng raster; trang chủ và tìm kiếm không hiện thao tác / Raster output; no action on home or search pages |
| Google Drive | Xem trước tệp tại `/file/d/.../view` / File preview at `/file/d/.../view` | Chụp trang đã render → jsPDF cục bộ / Rendered-page capture → local jsPDF | PDF phản ánh những gì trình xem render được / Output reflects what the viewer renders |
| PDF mẫu / Sample PDF | Mọi tab / Any tab | jsPDF cục bộ / Local jsPDF | Có thể dùng tóm tắt Wikipedia; lỗi mạng dùng Lorem cục bộ / May use Wikipedia summaries; local Lorem fallback on failure |

DocUnchain không cấp quyền truy cập mới. Chỉ dùng với tài liệu công khai hoặc tài liệu bạn được phép xem và lưu.<br>
DocUnchain does not grant new access. Use it only for public material or material you are authorized to view and save.

## Cài đặt / Installation

1. Tải hoặc clone repository này, rồi giải nén nếu tải ZIP. / Download or clone this repository; extract it if you downloaded a ZIP.
2. Mở `chrome://extensions/` trong Chrome.
3. Bật **Developer mode**.
4. Chọn **Load unpacked**.
5. Chọn thư mục gốc chứa `manifest.json`, rồi ghim DocUnchain lên thanh công cụ.

Chrome Manifest V3 là môi trường đích đã kiểm tra. Trình duyệt Chromium khác có thể hoạt động nhưng chưa được xác nhận; Firefox và Safari không được hỗ trợ.<br>
Chrome Manifest V3 is the tested target. Other Chromium browsers may work but are unverified; Firefox and Safari are unsupported.

## Cách dùng / Usage

1. Mở trang được hỗ trợ có nội dung bạn được phép lưu. / Open a supported page containing material you may save.
2. Mở DocUnchain từ thanh công cụ. / Open DocUnchain from the toolbar.
3. Chọn thao tác hiện ra cho trang đó. / Choose the action shown for that page.
4. Lưu từ hộp thoại in của Chrome, hoặc chờ PDF được tạo cục bộ. / Save from Chrome's print dialog, or wait for the local PDF to finish.

### Ghi chú theo luồng / Workflow notes

- **`Tải PDF Studocu`**: mở luồng in. **`Reset phiên Studocu`** là thao tác dọn phiên: xoá cookie Studocu/Studeersnel thông thường, giữ cookie xác minh Cloudflare, rồi tải lại trang.
- **`Tải PDF Scribd`**: chuyển sang luồng embed/in khi route hiện tại được hỗ trợ.
- **`Tải PDF SlideShare`**: xuất các ảnh slide công khai đang khả dụng thành PDF cục bộ. Có thể dùng nút trong popup hoặc nút nổi trên trang bài trình bày.
- **`Tải PDF Google Drive`**: quét bản xem trước rồi tạo PDF từ các trang đã render. Chờ hoàn tất trước khi đóng trang.
- **`Tạo PDF rác`**: công cụ PDF mẫu tùy chọn, giới hạn 1–10 tệp, 1–10 trang mỗi tệp và 1–10 đoạn Wikipedia. Tên nút giữ nguyên theo giao diện.

## Quyền riêng tư & quyền hạn / Privacy & permissions

PDF được tạo trong trình duyệt khi luồng hỗ trợ tạo PDF cục bộ; nội dung nguồn chỉ được yêu cầu từ dịch vụ hoặc CDN liên quan. Không có luồng nào trong extension tải tài liệu lên máy chủ do DocUnchain vận hành.<br>
Where a workflow creates a local PDF, assembly happens in the browser; source content is requested only from the relevant service or CDN. The extension has no DocUnchain-operated document-upload flow.

| Quyền / Permission | Mục đích / Purpose |
|---|---|
| `activeTab` | Nhận diện trang đang mở và gửi thao tác do người dùng yêu cầu / Detect the active page and dispatch a user-requested action |
| `scripting` | Chạy transport phản hồi do người dùng gửi từ tab hiện tại / Run the user-submitted feedback transport from the active tab |
| `downloads` | Hỗ trợ tải các PDF được tạo / Support generated-PDF downloads |
| `cookies` | Dọn cookie phiên Studocu/Studeersnel thông thường, vẫn giữ `cf_*`, `__cf*`, `_cfuvid` / Clear ordinary Studocu/Studeersnel session cookies while retaining `cf_*`, `__cf*`, `_cfuvid` |

Các host trong [manifest.json](manifest.json) chỉ phục vụ các luồng sau: Studocu/Studeersnel và document assets; Scribd; Google Drive; SlideShare và CDN của SlideShare; Wikipedia cho PDF mẫu; FormSubmit cho phản hồi được gửi rõ ràng bởi người dùng.<br>
Hosts in [manifest.json](manifest.json) serve only these flows: Studocu/Studeersnel and document assets; Scribd; Google Drive; SlideShare and its CDN; Wikipedia for sample PDFs; FormSubmit for feedback explicitly sent by the user.

### Lời gọi bên ngoài tùy chọn / Optional external calls

- **PDF mẫu**: lấy tóm tắt ngẫu nhiên từ `vi.wikipedia.org` hoặc `en.wikipedia.org` khi có mạng; dùng Lorem cục bộ nếu không lấy được.
- **Báo lỗi**: chỉ gửi sau khi người dùng bấm **Gửi báo lỗi**. FormSubmit nhận nội dung phản hồi, tên/phiên bản extension, thông tin trình duyệt, thời điểm gửi, cùng URL trang hiện tại *nếu* người dùng giữ tùy chọn đính kèm URL. URL này loại bỏ thông tin đăng nhập, query và fragment. Không gửi dữ liệu nhạy cảm trong phản hồi.
- **Sample PDF**: fetches random summaries from `vi.wikipedia.org` or `en.wikipedia.org` when available; it falls back to local Lorem text on failure.
- **Feedback**: sent only after the user presses **Gửi báo lỗi**. FormSubmit receives the report, extension name/version, browser information, timestamp, and the current-page URL *only if* the user keeps the URL option enabled. That URL has credentials, query, and fragment removed. Do not submit sensitive data.

## Giới hạn & sử dụng hợp pháp / Limitations & lawful use

- Chỉ dùng với tài liệu công khai hoặc tài liệu bạn được phép truy cập và lưu. Tôn trọng bản quyền, giấy phép, quy định của tổ chức và Điều khoản dịch vụ của mỗi nền tảng.<br>
  Use only public material or material you are authorized to access and save. Respect copyright, licenses, institutional rules, and each platform's Terms of Service.
- DocUnchain không liên kết với Studocu, Scribd, SlideShare, Google hoặc chủ sở hữu của họ.<br>
  DocUnchain is not affiliated with Studocu, Scribd, SlideShare, Google, or their owners.
- Extension không mở khóa nội dung riêng tư, trả phí, đã xoá, bị giới hạn tài khoản hoặc bị máy chủ giữ lại.<br>
  The extension does not unlock private, paid, deleted, account-gated, or server-withheld content.
- Thay đổi giao diện, truy cập, mạng hoặc cơ chế render của nguồn có thể làm một phần hoặc toàn bộ xuất PDF không hoàn chỉnh. PDF là nội dung đã render, không phải bản gốc có thể chỉnh sửa.<br>
  Source UI, access, network, or rendering changes can make an export partial or unavailable. PDFs represent rendered content, not editable originals.

## Phát triển, kiểm thử & kiến trúc / Development, testing & architecture

Cài dependencies khi cần: / Install dependencies when needed:

```bash
npm install
```

Chạy bốn suite Node: bố cục in Scribd, phản hồi, Google Drive và SlideShare. Đây là kiểm tra wiring/harness; không thay thế kiểm thử Chrome thật.<br>
Run four Node suites: Scribd print layout, feedback, Google Drive, and SlideShare. They are wiring/harness checks, not a replacement for live Chrome testing.

```bash
npm test
```

| Khu vực / Area | Trách nhiệm / Responsibility |
|---|---|
| [`popup/`](popup/) | Nhận diện trang, gửi thao tác, PDF mẫu và phản hồi / Page detection, actions, sample PDFs, and feedback |
| [`content/`](content/) | Các luồng chụp/xuất riêng theo dịch vụ / Site-specific capture and export flows |
| [`background.js`](background.js) | Dọn phiên Studocu/Studeersnel và relay ảnh CDN SlideShare đã kiểm tra host / Studocu/Studeersnel session cleanup and validated SlideShare CDN image relay |
| [`lib/jspdf.umd.min.js`](lib/jspdf.umd.min.js) | Tạo PDF được bundle cục bộ / Bundled local PDF generation |

## Credits

- Phần lõi Studocu kế thừa từ [danieltyukov/studocuhack](https://github.com/danieltyukov/studocuhack), giấy phép MIT.
- Bản bundle [`jsPDF`](https://github.com/parallax/jsPDF) trong [`lib/`](lib/) theo giấy phép MIT.

## License

Repository được phát hành theo [MIT License](LICENSE).<br>
This repository is distributed under the [MIT License](LICENSE).
