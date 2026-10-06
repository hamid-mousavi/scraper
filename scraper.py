import os
import requests
from bs4 import BeautifulSoup
import boto3

CHANNEL = "MajalesAlKhaqani"
URL = f"https://t.me/s/{CHANNEL}"
HISTORY_FILE = "uploaded_history.txt"

# اتصال به S3 ابر آروان
s3 = boto3.client(
    "s3",
    endpoint_url=os.environ["ARVAN_ENDPOINT"],
    aws_access_key_id=os.environ["ARVAN_ACCESS_KEY"],
    aws_secret_access_key=os.environ["ARVAN_SECRET_KEY"],
)
BUCKET = os.environ["ARVAN_BUCKET_NAME"]

HEADERS = {
    "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) Chrome/124.0.0.0 Safari/537.36"
}

def load_history():
    if os.path.exists(HISTORY_FILE):
        with open(HISTORY_FILE, "r", encoding="utf-8") as f:
            return set(line.strip() for line in f if line.strip())
    return set()

def save_history(history):
    with open(HISTORY_FILE, "w", encoding="utf-8") as f:
        for item in sorted(history):
            f.write(f"{item}\n")

def run():
    history = load_history()
    response = requests.get(URL, headers=HEADERS, timeout=20)
    if response.status_code != 200:
        print(f"Error fetching channel: {response.status_code}")
        return

    soup = BeautifulSoup(response.text, "html.parser")
    messages = soup.find_all("div", class_="tgme_widget_message")

    for msg in messages:
        audio_tag = msg.find("audio")
        if not audio_tag or not audio_tag.get("src"):
            continue

        post_id = msg.get("data-post", "").split("/")[-1]
        if not post_id or post_id in history:
            continue

        audio_url = audio_tag["src"]
        
        # استخراج متادیتا
        title_el = msg.find("div", class_="tgme_widget_message_document_title")
        performer_el = msg.find("div", class_="tgme_widget_message_document_subtitle")
        title = title_el.get_text(strip=True) if title_el else "Audio"
        performer = performer_el.get_text(strip=True) if performer_el else "Madah"

        filename = f"{post_id}_{performer}_{title}.mp3".replace("/", "_").replace(" ", "_")
        temp_path = f"/tmp/{filename}"

        print(f"در حال پردازش: {performer} - {title}")

        # ۱. دانلود فایل موقت
        with requests.get(audio_url, headers=HEADERS, stream=True, timeout=60) as r:
            r.raise_for_status()
            with open(temp_path, "wb") as f:
                for chunk in r.iter_content(chunk_size=1024 * 1024):
                    f.write(chunk)

        # ۲. آپلود به ابر آروان با دسترسی عمومی
        s3_key = f"tracks/{filename}"
        s3.upload_file(
            temp_path,
            BUCKET,
            s3_key,
            ExtraArgs={"ACL": "public-read", "ContentType": "audio/mpeg"}
        )
        print(f"آپلود موفق به آروان: {s3_key}")

        # پاک کردن فایل موقت برای حفظ فضای سرور
        os.remove(temp_path)
        history.add(post_id)

    save_history(history)

if __name__ == "__main__":
    run()

