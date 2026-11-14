# Design System: Biller POS Modern Redesign

## 1. Visual Theme & Atmosphere
A high-efficiency, daily-driver Point of Sale interface designed for speed, legibility, and modern tactile precision. The layout is clean and structured with zero unnecessary clutter—offering a high-contrast dark/light mode adaptable atmosphere with a crisp modern layout. It emphasizes clear numbers, spacious touch targets for busy till environments, and a smooth modern aesthetic.

## 2. Color Palette & Roles
- **Canvas/Background** (`#09090b` / `#f4f4f5`) — Main background
- **Card Surface** (`#18181b` / `#ffffff`) — Container & sheet cards
- **Primary Accent** (`#2563eb`) — Active tabs, main checkout button, key actions
- **Secondary Surface** (`#27272a` / `#e4e4e7`) — Neutral buttons, input fields
- **Text Primary** (`#fafafa` / `#09090b`) — High contrast headlines & primary labels
- **Text Muted** (`#a1a1aa` / `#71717a`) — Secondary details, unit prices, hints
- **Success/Paid** (`#16a34a`) — Payment complete, active statuses
- **Warning/Pending** (`#d97706`) — Awaiting approval, pending payment
- **Danger/Delete** (`#dc2626`) — Delete actions, overdue status

## 3. Typography Rules
- **Font Family:** `Instrument Sans`, `Inter`, or system sans-serif
- **Headlines:** Medium to Semi-Bold, crisp spacing, non-screaming
- **Body & Labels:** Clean, highly legible at small sizes
- **Numbers/Prices:** Semi-Bold, tabular figures (`font-variant-numeric: tabular-nums`)

## 4. Component Stylings
- **Navigation Bar:** Sleek top bar with quick action buttons (Search, Scan, Cart) and subtle active indicators. Floating modern bottom navigation for main tabs.
- **Product Cards / Grid:** Clean bordered/elevated cards with clear pricing, image thumbnails, and immediate tap-to-add action feedback.
- **Cart & Checkout:** High visibility total display, clean itemized rows with quick quantity adjustments, prominent action buttons.
- **Buttons:** Tactile feedback, clean borders, rounded corners (8px - 12px), primary blue fill for checkout.
- **Modals & Sheets:** Modern slide-up panels with rounded top corners, clear headers, and full-width actions.

## 5. Layout Principles
- **Grid Strategy:** Flexible auto-fit grid for product items, collapsing gracefully on smaller screens.
- **Touch-Friendly:** Minimum 44px height for interactive elements to facilitate fast tapping on phone/tablet POS screens.
- **Compact & Dense:** High information density without feeling crowded, ensuring key details (price, stock, total) are visible at a glance.
