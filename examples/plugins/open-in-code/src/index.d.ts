// extism-js 가 읽는 선언. 내보낼 함수와 가져다 쓸 호스트 함수를 적는다.
// 여기 적은 호스트 함수의 권한(docket_run → process:code)이 plugin.json 에 없으면 앱이 이 플러그인을 띄우지 않는다.
declare module "main" {
	export function on_command(): I32;
}

declare module "extism:host" {
	interface user {
		docket_run(ptr: I64): I64;
	}
}
