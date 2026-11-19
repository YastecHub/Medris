import { sharePage } from "../_share.js";

export const onRequestGet = (context) => sharePage(context, { storefront: context.params.id });
