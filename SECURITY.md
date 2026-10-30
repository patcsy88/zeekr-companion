# Security Policy

Zeekr Companion is a personal project for one owner, self-hosted and not offered as a service. There are no releases or supported versions: only the latest commit on `main` is maintained.

## Reporting a vulnerability

Please report it privately, not in a public issue.

- Use GitHub's private vulnerability reporting: open the repository's **Security** tab and choose **Report a vulnerability**.
- If that option is not shown, open a public issue that says only "security contact requested", with no details, and the owner will reply with a private route.

This is a one-person project, so there is no guaranteed response time. Reports will be read and answered as soon as the owner can.

## What is in scope

- The code in this repository (API, web client, infrastructure files, scripts).
- Mistakes that expose secrets or owner data, such as a committed key or a weakness in sign-in, rate limiting or backup handling.

## Please do not

- Test against anyone's running instance, or access data that is not yours.
- Include real credentials, vehicle identifiers or personal data in a report.

The repository holds no secrets, VIN, plate or host details by design. If you find any, that is itself a report worth making.
