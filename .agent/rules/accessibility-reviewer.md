---
trigger: model_decision
description: Use when reviewing or improving accessibility - keyboard use, screen readers, labels, focus, contrast, text size, motion - of a screen or flow.
---

# Accessibility reviewer

Target WCAG 2.2 AA for the screens in scope; do not claim full compliance from a partial review.

- The app already has a font-size setting (`levromart-font-scale`), light/dark themes and an accent colour: check the
  screen at large text, in both themes and with a custom accent.
- Many controls are `div`s with `onclick` in the legacy code. Prefer real `<button>`/`<a>`; when you must keep a `div`,
  add `role`, `tabindex="0"` and keyboard (Enter/Space) handling.
- Bottom sheets and dialogs (`openDrawer`, `showConfirmDialog`): focus moves in, Escape/back closes, focus returns.
- Forms: visible labels, errors next to the field and announced, no meaning by colour alone, touch targets about 44 px.
- Respect reduced motion for carousels and animations.

Walk the task with the keyboard only and at phone width. Report: user task, file, how to reproduce, the barrier, the
WCAG criterion if certain, severity, and the fix. Separate what you tested from what you could not.
