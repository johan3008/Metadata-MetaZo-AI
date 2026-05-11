# Changelog

All notable changes to this project will be documented in this file.

## [1.5.0] - 2026-05-11

### Added
- Support for `meta-llama/llama-4-scout-17b-16e-instruct` model via Groq API.
- Multi-frame visual analysis for Video assets (Extracting Start, Middle, and End frames for triple accuracy).
- Intellectual Property (IP) and Trademark protection logic in SEO generation (filtering out brand names like Nike, iPhone, etc.).
- Media-specific SEO strategies for Photographs, Videos, and Vector illustrations.

### Improved
- **Title Consistency**: Enhanced logic to ensure Title and Description precisely match user-defined character lengths.
- **Keyword Hierarchy**: Re-engineered keyword ordering to prioritize high-volume search terms (Anchor keywords) and buyer intent.
- **Failover System**: Robust multi-provider fallback mechanism (Gemini Primary -> Groq Secondary) with automatic model switching on 404/Quota errors.
- **JSON Stability**: Improved JSON extraction and repair logic for more reliable metadata parsing.
- **Market relevance**: Updated SEO prompts to target 2026 Microstock market trends.

### Fixed
- Fixed issues where title length would deviate from metadata settings.
- Corrected category mapping for Adobe Stock to strictly follow official taxonomies.
- Improved stopword filtering for keyword generation.

## [1.4.0] - Previous Version
- Initial stable release with Gemini and Groq integration.
