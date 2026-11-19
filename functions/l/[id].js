import { sharePage } from "../_share.js";

export const onRequestGet = (context) => sharePage(context, { levi: context.params.id });
