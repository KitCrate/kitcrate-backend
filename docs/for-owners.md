---
layout: page
title: For Owners
---

# For Owners

This page is for someone listing equipment on KitCrate. It assumes no
blockchain experience. You'll need the [Freighter](https://www.freighter.app/)
browser extension installed, since it's what signs transactions on your
behalf; the app prompts you to connect it wherever you need to sign
something.

## Listing an item

Go to **List an item** in the app and fill in the title, description,
photos, daily rate, and the deposit you want to require. Submitting the
form creates the listing. This step doesn't touch the blockchain at all;
your listing is stored by KitCrate's backend like any normal web form.

## What happens when it's booked

A renter picks dates and books your item. At that point an agreement
exists on-chain, but no money has moved yet. The renter still has to
**fund** the agreement, which sends the rental fee plus the deposit from
their wallet into the escrow contract. Once that happens, the agreement's
status changes to **Funded** and you can start the rental.

While an agreement has a committed booking against it (funded or later),
it's automatically hidden from the public browse list, so it won't show up
as available while it's in use. It reappears once the rental completes or
is cancelled.

## Starting the rental

Once the agreement is **Funded**, hand the item to the renter, then go to
the agreement page and click **Start rental**. You'll be asked to confirm,
then Freighter will ask you to sign. Once you confirm, the agreement moves
to **Active** and the claim window starts counting down from the rental's
end date. Right now that window is 3 days after the rental's scheduled end
date, the same for every booking.

You don't need to do anything else if the item comes back in good shape.
Once the claim window closes, anyone (you, the renter, or KitCrate) can
trigger the final step, and the rental fee is sent to you automatically.

## Raising a claim

If the item comes back damaged, go to the agreement page while it's still
**Active** and the claim window hasn't closed yet. You'll see a form asking
for:

- **A claim amount.** How much of the security deposit you're claiming,
  up to the full deposit amount. You can't claim more than the deposit
  itself.
- **A link to photos or notes** documenting the damage. This is stored with
  your claim so a reviewer can see it later. It's just a URL, so it can
  point to photos you've uploaded anywhere, a shared document, or anything
  else that shows the damage.

Submitting the claim moves the agreement to **Disputed**. Money doesn't
move yet. A KitCrate arbiter reviews the evidence off-chain and decides how
to split the deposit between you and the renter. Once that decision is made
on-chain, you receive your share of the deposit plus the full rental fee,
which you're always owed regardless of the dispute's outcome. The renter
receives whatever share of the deposit the arbiter didn't award to you.

If you don't raise a claim before the window closes, you can't raise one
afterward. The deposit is released to the renter automatically once the
window passes.

## Cancelling before it's funded

If you need to back out of a booking before the renter has funded it (the
agreement is still in status **Created**), either you or the renter can
cancel it. Once it's been funded, cancellation isn't available; the rental
has to run its normal course from there.
