---
layout: page
title: For Renters
---

# For Renters

This page is for someone booking equipment on KitCrate. It assumes no
blockchain experience. You'll need the [Freighter](https://www.freighter.app/)
browser extension installed and a wallet funded with the token the listing
is priced in (native XLM on the currently documented Testnet deployment;
see [Protocol Mechanics](protocol-mechanics.html) for how that was
confirmed). The app prompts you to connect Freighter wherever you need
to sign something.

## Browsing and booking

The **Browse** page shows items currently available. Booked items (funded
or further along) are hidden from this list automatically, so what you see
is what's actually free to rent. Open a listing, pick a start and return
date, and review the booking: it shows your total rental cost and the
security deposit you'll need to lock up.

Confirming the booking asks Freighter to sign a transaction. This step
creates the agreement on-chain, naming you as the renter, the owner, the
item, the dates, and the amounts, but it does not move any money yet. You
fund the agreement separately, in the next step.

## What funding actually does with your money

On the agreement page, you'll see a **Fund agreement** button once your
booking exists. Clicking it and confirming sends the rental fee plus the
full security deposit from your wallet into the escrow contract, in one
transaction. That money isn't going to the owner and it isn't going to
KitCrate. It sits in the smart contract until the rental is settled one of
two ways:

- **No claim:** once the claim window closes after the rental's end date,
  the deposit comes back to you and the rental fee goes to the owner.
- **A claim is raised:** the deposit is split between you and the owner
  based on an arbiter's decision (see below). Either way, the rental fee
  itself always goes to the owner; it isn't part of what's being disputed.

You won't get any of that money back before the rental is fully settled —
with one exception. If the owner never confirms handover (never clicks
**Start rental**) after you've funded, you're not stuck waiting on them
forever: seven days after you funded, anyone can trigger a recovery that
refunds you in full, the rental fee and the deposit together, and closes
the agreement out as **Expired**. The owner receives nothing in that case,
since no handover was ever confirmed. If the owner does start the rental
within those seven days, this never comes into play at all.

## What happens if a claim is raised against your deposit

If the owner reports damage before the claim window closes, the agreement
moves to **Disputed**. You don't need to do anything at this point; the
owner has already submitted a claim amount and evidence. A KitCrate
arbiter reviews it off-chain and decides how much of the deposit goes to
each side.

Once that decision is recorded on-chain, whatever share of the deposit the
arbiter didn't award to the owner is sent to you automatically. The rental
fee you originally paid goes to the owner regardless, since it was earned
by the rental happening at all; it's never part of what a claim can take
back.

If the arbiter never actually reviews the claim — fourteen days pass with
no decision — anyone can trigger a fallback that settles it the same way
an arbiter awarding the owner nothing would: your full deposit comes back
to you. An unreviewed claim never defaults in the owner's favor.

If no claim is raised, none of this applies. The claim window is currently
3 days after the rental's scheduled end date, the same for every booking.
Once it closes with no claim, your full deposit is released back to you,
triggered by whoever calls the release step first (you, the owner, or
KitCrate); it doesn't matter who clicks it, the outcome is the same.

## Cancelling before you've funded

If you change your mind after booking but before funding (the agreement is
still in status **Created**), either you or the owner can cancel it. Once
you've funded it, cancellation isn't available from your side; the rental
runs its course through the normal settlement or dispute path from there.
