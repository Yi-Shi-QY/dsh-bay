# DSH ecosystem reference

DSH Bay follows the repository conventions that make popular DSH projects
easy to understand and install. The references below were checked on
2026-11-04. They are product and documentation references only; DSH Bay does
not copy their source code or claim to be affiliated with them.

| Reference | What we adopted | What stays different in DSH Bay |
| --- | --- | --- |
| [awesome-dsh-plugin](https://github.com/awesome-dsh-plugin/awesome-dsh-plugin) | A clear product description, install identity and discoverable keywords | DSH Bay remains private and is not submitted to a public catalog yet |
| [dsh-market](https://github.com/dsh-market/dsh-market) | Versioned metadata and an explicit install boundary | Plugin installation still goes through the native DSH Plugin Manager; DSH Bay does not ship a second marketplace |
| [modlens](https://github.com/liustack/modlens) | A focused product name, bilingual value proposition and a small runnable entry point | DSH Bay's first candidate is a Core runtime for composing official surfaces |
| [dsh-context](https://github.com/bowenliang123/dsh-context) | Feature-oriented README language and a clear list of user-visible capabilities | DSH Bay keeps provenance and compatibility contracts alongside the runtime because it tracks DSH rc1 closely |
| [dsh-genui](https://github.com/omdsh-dev/dsh-genui) | Separation of runtime, skills and future extension surfaces | Conversation Suite, Creator UI and catalog sharing remain deferred from this Core-only candidate |

These references lead to five repository rules:

1. The root README explains the user benefit before implementation details.
2. The package identity, DSH generation and upstream commit are visible and
   machine-checkable.
3. The runnable Core package stays small; historical research, launcher code
   and generated release artifacts stay out of this repository.
4. Installation and release metadata are explicit enough for a future public
   catalog, while private staging remains the current status.
5. Security, contribution and validation notes are present before the first
   public release.
