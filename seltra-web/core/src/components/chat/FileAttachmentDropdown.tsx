import { MessageSquare, Upload } from "lucide-react";
import { DropdownMenuItem } from "@/components/ui/dropdown-menu";
import { useRef } from "react";

interface FileAttachmentDropdownProps {
  onFileSelect: (
    files: FileList,
    type: "chat-context" | "upload-to-codebase",
  ) => void;
  closeMenu?: () => void;
}

export function FileAttachmentDropdown({
  onFileSelect,
  closeMenu,
}: FileAttachmentDropdownProps) {
  const chatContextFileInputRef = useRef<HTMLInputElement>(null);
  const uploadToCodebaseFileInputRef = useRef<HTMLInputElement>(null);

  const handleChatContextClick = () => {
    chatContextFileInputRef.current?.click();
  };

  const handleUploadToCodebaseClick = () => {
    uploadToCodebaseFileInputRef.current?.click();
  };

  const handleFileChange = (
    e: React.ChangeEvent<HTMLInputElement>,
    type: "chat-context" | "upload-to-codebase",
  ) => {
    if (e.target.files && e.target.files.length > 0) {
      onFileSelect(e.target.files, type);
      // Clear the input value so the same file can be selected again
      e.target.value = "";
      // Close the parent menu after file selection
      closeMenu?.();
    }
  };

  const menuItems = (
    <>
      <DropdownMenuItem
        closeOnClick={false}
        onClick={handleChatContextClick}
        className="py-3 px-4"
        title="Images, ZIP archives, documents, and source files"
      >
        <MessageSquare size={16} className="mr-2" />
        Attach file as chat context
      </DropdownMenuItem>

      <DropdownMenuItem
        closeOnClick={false}
        onClick={handleUploadToCodebaseClick}
        className="py-3 px-4"
        title="Images, ZIP archives, documents, and source files"
      >
        <Upload size={16} className="mr-2" />
        Upload file to codebase
      </DropdownMenuItem>
    </>
  );

  const hiddenInputs = (
    <>
      <input
        type="file"
        data-testid="chat-context-file-input"
        ref={chatContextFileInputRef}
        onChange={(e) => handleFileChange(e, "chat-context")}
        className="hidden"
        multiple
        accept=".zip,.jpg,.jpeg,.png,.gif,.webp,.pdf,.txt,.md,.js,.ts,.html,.css,.json,.csv,*/*"
      />
      <input
        type="file"
        data-testid="upload-to-codebase-file-input"
        ref={uploadToCodebaseFileInputRef}
        onChange={(e) => handleFileChange(e, "upload-to-codebase")}
        className="hidden"
        multiple
        accept=".zip,.jpg,.jpeg,.png,.gif,.webp,.pdf,.txt,.md,.js,.ts,.html,.css,.json,.csv,*/*"
      />
    </>
  );

  return (
    <>
      {menuItems}
      {hiddenInputs}
    </>
  );
}
