from email.message import EmailMessage
import smtplib
from ..config import settings


def send_email_with_attachments(
    *,
    to_email: str | list[str],
    subject: str,
    body: str,
    attachments: list[tuple[str, bytes, str]],
) -> None:
    if not settings.SMTP_HOST or not settings.SMTP_FROM:
        raise RuntimeError("SMTP settings not configured")

    to_list = [to_email] if isinstance(to_email, str) else list(to_email)
    # bcc_list = ["second_recipient@mail.net"]

    msg = EmailMessage()
    msg["From"] = settings.SMTP_FROM
    msg["To"] = ", ".join(to_list)
    msg["Subject"] = subject
    msg.set_content(body)

    for filename, data, mime in attachments:
        maintype, subtype = mime.split("/", 1)
        msg.add_attachment(data, maintype=maintype, subtype=subtype, filename=filename)

    with smtplib.SMTP(settings.SMTP_HOST, settings.SMTP_PORT) as s:
        s.starttls()
        if settings.SMTP_USER:
            s.login(settings.SMTP_USER, settings.SMTP_PASS)
        # Note: 'send_message' can handle multiple recipients in the 'To' field, so we pass the list directly.
        # s.send_message(msg, toaddrs=to_list + bcc_list)  # If you want to add BCC recipients
        s.send_message(msg, to_addrs=to_list)