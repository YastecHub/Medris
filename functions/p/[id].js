import { sharePage } from "../_share.js";

export const onRequestGet = (context) => sharePage(context, { product: context.params.id });
