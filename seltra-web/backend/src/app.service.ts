import { Injectable } from '@nestjs/common';

@Injectable()
export class AppService {
  getServerInfo(): any {
    return {
      "success":true,
      "message":"Seltra server is running....",
      "description":"seltra is commerce that runs itself: An AI-native commerce stack that automatically creates, runs, and scales online stores for SMEs worldwide.",
      "version":"1.0.0","year":2026};
  }
}
