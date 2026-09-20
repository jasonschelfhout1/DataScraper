# Archive-first architecture

Normal browser traffic is archive-only: React calls Express, Express queries PostgreSQL, and eligible downloads receive a short-lived private R2 URL. The web service never imports or calls the Omgevingsloket provider.

The crawler is the only component that contacts the official site. It stores normalized project/document metadata and durable work state in PostgreSQL, and streams only `PUBLIEK_DOWNLOAD` documents to private R2 storage. View-only documents remain metadata-only records.

The archive becomes more complete over time as public projects are observed. It cannot recover projects whose publication period ended before a successful discovery run observed them.

Global project enumeration and `Inhoud aanvraag` document traversal remain unsupported until a user-authorized capture proves their official endpoint contracts. No route is guessed.
